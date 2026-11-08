// Every word both UIs show, in one place: [Chinese, English]. `{name}` marks a value filled in by `t`.
export const strings = Object.freeze({
  // Playback state
  smooth: ['播放流畅', 'Playing smoothly'], smoothDetail: ['画面连续，缓冲充足', 'Frames advancing, buffer healthy'],
  playing: ['正在播放', 'Playing'], playingDetail: ['等待画面确认', 'Waiting for frame evidence'],
  buffering: ['正在缓冲', 'Buffering'], bufferingDetail: ['缓冲不足，正在等数据', 'Buffer is low, waiting for data'],
  frozen: ['画面卡住了', 'Playback stalled'], frozenDetail: ['画面停住了，正在等待恢复', 'Frames stopped, waiting to recover'],
  paused: ['已暂停', 'Paused'], pausedDetail: ['继续播放后恢复监测', 'Monitoring resumes when playback does'],
  seeking: ['正在跳转', 'Seeking'], seekingDetail: ['等待新的画面', 'Waiting for new frames'],
  ended: ['播放结束', 'Ended'], endedDetail: ['视频已播放完毕', 'The video has finished'],
  waiting: ['等待播放', 'Waiting for playback'], waitingDetail: ['视频开始后显示数据', 'Data appears once the video starts'],
  error: ['播放出错', 'Playback error'], errorDetail: ['播放器报告了错误', 'The player reported an error'],
  defaultOn: ['使用 B站默认线路', 'Using Bilibili default'], defaultOnDetail: ['不测速，也不换线', 'No speed tests and no switching'],
  region: ['所在地区无法播放', 'Not available in your region'], regionDetail: ['B站没有为你所在的地区提供这个视频，换线路也无法解决。', 'Bilibili does not offer this video in your region. Changing servers cannot fix this.'],
  payment: ['需要付费观看', 'Paid video'], paymentDetail: ['这个视频需要付费，换线路也无法解决。', 'This video requires payment. Changing servers cannot fix this.'],
  unavailable: ['视频无法播放', 'Video unavailable'], unavailableDetail: ['B站没有返回这个视频的播放地址。', 'Bilibili returned no playback address for this video.'],

  // Values
  speed: ['下载速度', 'Download speed'], buffered: ['已缓冲', 'Buffered'], seconds: ['秒', 's'], times: ['{n} 次', '{n}'],
  server: ['线路', 'Server'], servers: ['线路', 'Servers'], serving: ['正在供片', 'Serving'], currentServer: ['当前线路', 'Current server'],
  ms: ['{n} 毫秒', '{n} ms'], notTested: ['未测速', 'Not tested'], justNow: ['刚刚', 'just now'], minutesAgo: ['{n} 分钟前', '{n} min ago'], hoursAgo: ['{n} 小时前', '{n} h ago'],
  last45: ['下载速度，最近 45 秒', 'Download speed, last 45 seconds'], ago45: ['45 秒前', '45 s ago'], now: ['现在', 'Now'], liveSpeed: ['实时速度', 'Live speed'],

  // Server choice
  automatic: ['自动选择', 'Automatic'], automaticDetail: ['选最快的线路，卡顿时自动换线', 'Picks the fastest server and switches on stalls'], recommended: ['推荐', 'Recommended'],
  biliDefault: ['B站默认', 'Bilibili default'], biliDefaultDetail: ['不修改播放地址', 'Leaves playback addresses unchanged'],
  fixedGroup: ['固定使用一条线路', 'Always use one server'], use: ['使用', 'Use'], inUse: ['使用中', 'In use'],
  customServer: ['自定义线路', 'Custom server'], customPlaceholder: ['输入 upos 开头的 B站视频域名', 'Enter a Bilibili upos host'], addCustom: ['添加', 'Add'],
  badHost: ['只能填写 upos 开头的 bilivideo 域名，不含端口和路径。', 'Use an upos bilivideo host without a port or path.'],
  replaceWhen: ['什么时候替换', 'When to replace'], replaceSlow: ['只在变慢时', 'Only when slow'], replaceAlways: ['始终', 'Always'],
  firstByte: ['首字节', 'First byte'], tested: ['测速时间', 'Tested'], searchServers: ['搜索线路', 'Search servers'],

  // Speed tests
  test: ['测速', 'Test speed'], testing: ['正在测速…', 'Testing…'], cooldown: ['{n} 秒后可再测', 'Test again in {n} s'],
  testUnavailable: ['暂时没有可测的片段', 'Nothing to test right now'], testAutoOnly: ['选择“自动选择”后可以测速', 'Choose Automatic to test speed'],
  resultFastest: ['测速完成，{host}最快', 'Test finished. {host} is fastest'], resultSwitched: ['测速完成，已换到{host}', 'Test finished. Switched to {host}'],
  resultKept: ['测速完成，保留{host}', 'Test finished. Kept {host}'], clearData: ['清除测速数据', 'Clear speed data'], cleared: ['已清除测速数据', 'Speed data cleared'],
  history: ['测速和换线', 'Tests and switches'], historyTest: ['测速', 'Test'], historySwitch: ['换线', 'Switch'], historyEmpty: ['这个视频还没有测速或换线', 'No tests or switches for this video yet'],
  outcomeFastest: ['当前最快', 'Current fastest'], outcomeSwitched: ['已换线', 'Switched'], outcomeKept: ['保留当前', 'Kept current'], outcomeNone: ['没有结果', 'No result'],
  scopeFragment: ['仅一个片段', 'One segment'], scopeVideo: ['整个视频', 'Whole video'],

  // Floating control
  dashboard: ['仪表盘', 'Dashboard'], more: ['更多', 'More'], collapse: ['收起', 'Collapse'], moveTo: ['移到', 'Move to'],
  topLeft: ['左上', 'Top left'], topRight: ['右上', 'Top right'], bottomLeft: ['左下', 'Bottom left'], bottomRight: ['右下', 'Bottom right'], resetPosition: ['复位', 'Reset position'], positionReset: ['已复位', 'Position reset'],
  entryLabel: ['BiliSmooth：悬停查看，点击展开，可拖动', 'BiliSmooth: hover to preview, click to expand, drag to move'],
  panelLabel: ['BiliSmooth 播放面板', 'BiliSmooth playback panel'], moveHint: ['拖动或用方向键移动，Home 复位', 'Drag or use arrow keys to move, Home to reset'],
  noRoom: ['这里空间不够，拖到别处再展开', 'Not enough room here. Drag it elsewhere to expand.'],
  openFailed: ['仪表盘没有打开，请重试。', 'The dashboard did not open. Try again.'],
  backgroundUnavailable: ['仪表盘没有打开。请在扩展管理页重新加载 BiliSmooth。', 'The dashboard did not open. Reload BiliSmooth on the extensions page.'],
  saving: ['正在保存…', 'Saving…'], saved: ['已保存', 'Saved'], saveFailed: ['设置没有保存', 'Settings were not saved'], saveFailedDetail: ['请重试，之前保存的设置没有变化。', 'Try again. Your previous settings are unchanged.'],
  retry: ['重试', 'Retry'], actionFailed: ['操作没有完成，请重试。', 'That did not work. Try again.'],
  readFailedPanel: ['设置还没同步，可以在仪表盘重新连接。', 'Settings have not synced. Reconnect from the dashboard.'],
  applyReload: ['刷新后完全生效', 'Reload to apply fully'], applyReloadDetail: ['刚改的设置要刷新视频页后才完全生效。', 'The change applies fully after the video reloads.'],
  reload: ['刷新视频页', 'Reload video'], reloadFailed: ['设置没有确认保存，视频页没有刷新。', 'The save was not confirmed, so the video was not reloaded.'],

  // Dashboard frame
  overview: ['概览', 'Overview'], settings: ['设置', 'Settings'], log: ['记录', 'Log'], back: ['返回视频', 'Back to video'],
  runsLocally: ['仅在本机运行', 'Runs locally'], version: ['版本 {v}', 'Version {v}'], navigation: ['仪表盘导航', 'Dashboard navigation'],
  chooseVideo: ['选择视频标签页', 'Choose a video tab'], searchTabs: ['搜索视频标签页', 'Search video tabs'], noVideo: ['未连接视频', 'No video connected'],
  backgroundTab: ['后台标签页', 'Background tab'], noMatches: ['没有匹配的标签页', 'No matching tabs'], skip: ['跳到内容', 'Skip to content'], demoData: ['演示数据', 'Demo data'],

  // Dashboard notices
  connecting: ['正在连接视频页…', 'Connecting to the video tab…'], connectingDetail: ['设置现在就可以改。', 'You can change settings now.'],
  noTab: ['没有打开的 B站视频', 'No Bilibili video is open'], noTabDetail: ['在 B站打开一个视频，这里会自动连上。设置现在就可以改。', 'Open a video on Bilibili and this page connects by itself. You can change settings now.'],
  waitVideo: ['已连接，等待视频开始', 'Connected; waiting for the video to start'],
  noResponse: ['视频页没有响应', 'The video tab is not responding'], noResponseDetail: ['它可能正在刷新。稍后重试，或者刷新视频页。', 'It may be reloading. Try again, or reload the video.'],
  stale: ['需要刷新视频页', 'Reload the video tab'], staleDetail: ['扩展已经更新，刷新后才能连接。', 'BiliSmooth was updated. Reload the tab to connect.'],
  readFailed: ['读取设置失败', 'Could not read settings'], readFailedDetail: ['这里显示的可能不是最新设置。', 'What you see here may be out of date.'], reconnect: ['重新连接', 'Reconnect'],
  loadFailed: ['仪表盘没有加载完整，请刷新这个页面。', 'The dashboard did not load fully. Refresh this page.'],

  // Overview
  switchesThisVideo: ['本视频换线', 'Switches this video'], recoveredCount: ['卡顿恢复 {n} 次', '{n} stalls recovered'], recoveredOne: ['卡顿恢复 1 次', '1 stall recovered'],
  recent: ['最近记录', 'Recent activity'], seeAll: ['查看全部', 'See all'], allServers: ['全部线路', 'All servers'], ceiling: ['{n} MB/s', '{n} MB/s'],

  // Settings
  floating: ['浮窗', 'Floating control'], collapsedShows: ['收起时显示', 'When collapsed, show'],
  entryIcon: ['状态图标', 'Status icon'], entryBuffer: ['已缓冲', 'Buffered'], entrySpeed: ['下载速度', 'Download speed'], entryCombined: ['速度和缓冲', 'Speed and buffer'],
  position: ['位置', 'Position'], playback: ['播放', 'Playback'], stallSwitch: ['卡顿时自动换线', 'Switch servers on stall'], automaticOnly: ['仅在自动选择时', 'With Automatic only'],
  appearance: ['外观', 'Appearance'], theme: ['主题', 'Theme'], system: ['跟随系统', 'System'], light: ['浅色', 'Light'], dark: ['深色', 'Dark'],
  accent: ['强调色', 'Accent'], accentBlue: ['蓝', 'Blue'], accentTeal: ['青', 'Teal'], accentGreen: ['绿', 'Green'], accentOrange: ['橙', 'Orange'], accentPink: ['粉', 'Pink'], accentGraphite: ['石墨', 'Graphite'],
  language: ['语言', 'Language'], animations: ['动画效果', 'Animations'],
  advanced: ['高级', 'Advanced'], compatibility: ['兼容性', 'Compatibility'],
  mcdn: ['MCDN 地址', 'MCDN addresses'], relayAll: ['全部中转', 'Relay all'], byFormat: ['按格式', 'By format'], swapHost: ['直接换主机', 'Swap host'],
  ports: ['识别带端口的地址', 'Recognize addresses with ports'], akamai: ['包含 Akamai 线路', 'Include Akamai servers'], fixedOnly: ['仅在固定线路时', 'With a fixed server only'],
  p2p: ['限制 P2P 上传', 'Limit P2P upload'], afterReload: ['刷新视频页后生效', 'After the video reloads'],
  restoreDefaults: ['恢复默认设置', 'Restore defaults'], restoreDetail: ['线路和播放设置恢复默认，外观和记录保留。', 'Server and playback settings return to defaults. Appearance and the log are kept.'],
  restoreQuestion: ['恢复默认设置？', 'Restore defaults?'], restore: ['恢复', 'Restore'], cancel: ['取消', 'Cancel'], restored: ['已恢复默认设置', 'Defaults restored'],

  // Log
  firstFrame: ['首帧用时', 'Time to first frame'], stalls: ['卡顿', 'Stalls'], recovered: ['已恢复', 'Recovered'], switches: ['换线', 'Switches'],
  filterAll: ['全部', 'All'], filterPlayback: ['播放', 'Playback'], filterServers: ['线路', 'Servers'], filterProblems: ['异常', 'Problems'],
  exportDiagnostics: ['导出诊断', 'Export diagnostics'], exported: ['已导出诊断文件', 'Diagnostics exported'], clear: ['清空', 'Clear'],
  clearQuestion: ['清空记录？', 'Clear the log?'], clearDetail: ['清空后无法恢复。已经导出的诊断文件不受影响。', 'This cannot be undone. Diagnostics you exported are not affected.'], logCleared: ['已清空记录', 'Log cleared'],
  keepsLatest: ['保留最近 {n} 条', 'Keeps the latest {n}'], newRecords: ['{n} 条新记录', '{n} new records'], noRecords: ['没有符合条件的记录', 'No matching records'],
  categoryPlayback: ['播放', 'Playback'], categoryServer: ['线路', 'Server'], categoryProblem: ['异常', 'Problem'], categorySystem: ['系统', 'System'],
  eventRecovered: ['卡顿已恢复', 'Recovered from a stall'], eventStall: ['画面卡住', 'Playback stalled'], eventAttempt: ['尝试换线', 'Tried another server'],
  eventTest: ['测速', 'Speed test'], eventSwitch: ['换线', 'Switched server'], eventAvoid: ['避开失败的线路', 'Avoided a failing server'],
  eventTimeout: ['请求超时', 'Request timed out'], eventCancelled: ['请求取消', 'Request cancelled'], eventFailed: ['请求失败', 'Request failed'],
  eventRequest: ['下载视频片段', 'Downloaded a segment'], eventRouting: ['选择请求线路', 'Chose a request server'], eventAssessment: ['网络评估', 'Network check'],
  eventRetry: ['提前重试片段', 'Retried a segment early'], eventRetryObserved: ['片段已重试', 'Segment retried'], eventRetryDisabled: ['本页停用提前重试', 'Early retry turned off for this page'],
  eventPlaying: ['开始播放', 'Playback started'], eventBuffering: ['开始缓冲', 'Buffering started'], eventPaused: ['已暂停', 'Paused'], eventSeeking: ['跳转', 'Seeked'],
  eventStallEnded: ['卡顿结束', 'Stall ended'], eventOther: ['其他', 'Other']
});

// Returns t(key, values) for one language. Unknown keys return the key so a missing word is visible, never blank.
export function translator(lang) {
  const index = lang === 'en' ? 1 : 0;
  return (key, values) => {
    const row = strings[key];
    let text = row ? row[index] : key;
    if (values) for (const [name, value] of Object.entries(values)) text = text.replaceAll('{' + name + '}', String(value));
    return text;
  };
}
