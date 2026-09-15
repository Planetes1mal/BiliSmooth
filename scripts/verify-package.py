"""Read-only release verification. Version comes from package.json; reports never overwrite."""
import argparse
import hashlib
import json
import posixpath
import re
import struct
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
digest = lambda content: hashlib.sha256(content).hexdigest()


def local(relative):
    target = (ROOT / relative).resolve()
    if not target.is_relative_to(ROOT):
        raise ValueError(f'Path escapes workspace: {relative}')
    return target


def verify(version):
    listing = json.loads(local(f'outputs/release-{version}-files.json').read_text(encoding='utf-8-sig'))
    archive = local(listing['archive'])
    assert digest(archive.read_bytes()) == listing['sha256'], 'Archive SHA mismatch'
    assert local('outputs/SHA256SUMS.txt').read_text(encoding='utf-8') == f"{listing['sha256']}  {archive.name}\n", 'Release checksum file mismatch'
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        assert package.testzip() is None, 'ZIP CRC failure'
        assert sorted(names) == sorted(listing['files']), 'Release listing mismatch'
        assert len(names) == len(set(names)), 'Duplicate package paths'
        assert sorted(names) == sorted(str(p.relative_to(ROOT / 'dist/extension')).replace('\\', '/')
                                       for p in (ROOT / 'dist/extension').rglob('*') if p.is_file()), 'Build listing mismatch'
        for name in names:
            assert not PurePosixPath(name).is_absolute() and not ({'..', '.'} & set(name.split('/'))) and '\\' not in name and ':' not in name, name
            assert not ((package.getinfo(name).external_attr >> 16) & 0o170000) == 0o120000, 'Package contains a symlink'
            content = package.read(name)
            assert digest(content) == listing['fileSha256'][name], f'Release hash mismatch: {name}'
            assert content == local('dist/extension/' + name).read_bytes(), f'Build bytes differ: {name}'
        manifest = json.loads(package.read('manifest.json'))
        build = json.loads(package.read('BUILD.json'))
        assert manifest['version'] == listing['version'] == build['version'] == version, 'Version mismatch'
        assert manifest['manifest_version'] == 3
        assert 'default_popup' not in manifest['action']
        assert manifest['permissions'] == ['storage']
        assert manifest['host_permissions'] == ['https://*.bilibili.com/*', 'https://*.bilibili.tv/*']
        main = [entry for entry in manifest['content_scripts'] if entry.get('world') == 'MAIN']
        assert len(main) == 1 and main[0]['js'] == ['playback.js']
        assert sorted(names) == sorted([*build['outputSha256'], 'BUILD.json']), 'Build hash listing mismatch'
        for name, expected in build['outputSha256'].items():
            assert digest(package.read(name)) == expected, f'Build output hash mismatch: {name}'
        for name, expected in build['sourceSha256'].items():
            assert digest(local(name).read_bytes()) == expected, f'Build source became stale: {name}'
        references = [manifest['background']['service_worker'], *manifest['icons'].values()]
        assert manifest['action']['default_icon'] == manifest['icons'], 'Toolbar and product icon references differ'
        references += list(manifest['action']['default_icon'].values())
        references += [script for entry in manifest['content_scripts'] for script in entry['js']]
        background = package.read('background.js').decode()
        imports = re.search(r'importScripts\((.*?)\)', background)
        if imports:
            references += re.findall(r"['\"]([^'\"]+)['\"]", imports.group(1))
        references += re.findall(r"getURL\(['\"]([^'\"]+)['\"]\)", background)
        for name in names:
            if name.endswith('.html'):
                for ref in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', package.read(name).decode()):
                    target = ref.split('#')[0].split('?')[0]
                    if target and not re.match(r'(?:[a-z]+:|//)', target):
                        references.append(posixpath.normpath(posixpath.join(posixpath.dirname(name), target)))
        missing = sorted(set(references) - set(names))
        assert not missing, f'Unresolved package references: {missing}'
        dimensions = {}
        for size in (16, 32, 48, 128):
            icon_path = manifest['icons'][str(size)]
            content = package.read(icon_path)
            assert f'.{digest(content)[:12]}.' in icon_path, 'Icon reference is not bound to its content'
            assert content.startswith(b'\x89PNG\r\n\x1a\n')
            assert struct.unpack('>II', content[16:24]) == (size, size)
            dimensions[str(size)] = [size, size]
        assert package.read('control/tabler-LICENSE.txt') == local('src/ui/control/tabler-LICENSE.txt').read_bytes()
        assert package.read('control/motion-LICENSE.txt') == local('src/ui/control/motion-LICENSE.txt').read_bytes()
        assert b'MIT' in package.read('control/motion-LICENSE.txt')
        assert package.read('motion-runtime.js') == local('src/ui/motion-runtime.js').read_bytes()
        assert b'BiliSmoothMotion' in package.read('motion-runtime.js')
        assert '../motion-runtime.js' in package.read('control/index.html').decode()
        for name in ('LICENSE', 'NOTICE.md', 'README.md', 'README.en.md', 'PRIVACY.md', 'CHANGELOG.md',
                     'docs/licenses/bilibili-accelerator-MIT.txt'):
            assert package.read(name) == local(name).read_bytes(), f'Release documentation differs: {name}'
        upstream_license = package.read('docs/licenses/bilibili-accelerator-MIT.txt')
        assert b'MIT License' in upstream_license and b'Copyright' in upstream_license, 'Upstream license notice missing'
        result = {'passed': True, 'archive': listing['archive'], 'sha256': listing['sha256'], 'files': len(names),
                  'checks': ['ZIP CRC', 'Release SHA256SUMS matches ZIP', 'Exact unique safe package paths', 'Each packaged file matches release hashes and current build',
                             'Build source and output hashes match current workspace', 'Consistent version and one MAIN bundle',
                             'No toolbar popup; storage-only permissions and video-site hosts',
                             'Manifest, background and HTML resource references resolve', 'Toolbar PNG dimensions', 'Tabler and Motion licenses preserved',
                             'Bilingual README, privacy, changelog and unchanged upstream MIT notice included', 'Motion is locally bundled in both surfaces'],
                  'references': sorted(set(references)), 'iconDimensions': dimensions}
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', help='Optional workspace-relative report path; must not already exist.')
    args = parser.parse_args()
    version = json.loads(local('package.json').read_text(encoding='utf-8-sig'))['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid package version'
    report = local(args.report or f'outputs/package-validation-{version}.json')
    if report.exists():
        if args.report:
            raise FileExistsError(f'Refusing to overwrite report: {args.report}')
        report = report.with_name(report.stem + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + report.suffix)
    try:
        result = verify(version)
    except Exception as error:
        result = {'passed': False, 'error': str(error), 'errorType': type(error).__name__}
    result.update(version=version, at=datetime.now(timezone.utc).isoformat())
    scope = ['scripts/verify-package.py', 'scripts/build.mjs', 'scripts/package.mjs', 'package.json', 'src/extension/manifest.json']
    result['scope'] = scope
    result['sourceSha256'] = {name: digest(local(name).read_bytes()) for name in scope}
    report.parent.mkdir(parents=True, exist_ok=True)
    with report.open('x', encoding='utf-8') as output:
        output.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'passed': result['passed'], 'report': report.relative_to(ROOT).as_posix(),
                      'files': result.get('files'), 'sha256': result.get('sha256'), 'error': result.get('error')}))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
