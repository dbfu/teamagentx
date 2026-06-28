/**
 * 集中管理若干浮层的 z-index，避免散落的魔法数字导致层级关系被意外破坏。
 * 数值越大越靠上。新增浮层时在此登记，并在注释里写清相对关系。
 */
export const Z_INDEX = {
  /** 消息 hover 工具条：高于消息内容，但必须低于 chatHeader（溢出到顶部时被 header 盖住） */
  messageHoverToolbar: 30,
  /** 频道顶部 header：盖住溢出到顶部的 hover 工具条 */
  chatHeader: 40,
  /** 只读场景下的复制浮层（嵌在弹层里，需高于弹层内容） */
  readonlyCopyMenu: 1000,
} as const
