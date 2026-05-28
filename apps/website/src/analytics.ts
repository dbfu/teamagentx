const BAIDU_TONGJI_ID = 'b5d468313c3f6cd7aca9271894238f02'

export function initBaiduTongji() {
  window._hmt = window._hmt || []

  const script = document.createElement('script')
  script.src = `https://hm.baidu.com/hm.js?${BAIDU_TONGJI_ID}`

  const firstScript = document.getElementsByTagName('script')[0]
  firstScript?.parentNode?.insertBefore(script, firstScript)
}
