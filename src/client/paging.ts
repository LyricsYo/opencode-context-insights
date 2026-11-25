

export const MESSAGE_PAGE = 20
export const LIST_PAGE = 50

/** Grow a paged list only when its scroll container nears the bottom. */
export const growOnScroll = (
  event: { currentTarget: HTMLDivElement },
  shown: number,
  total: number,
  grow: (next: number) => void,
) => {
  const el = event.currentTarget
  if (shown >= total) return
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 24) return
  grow(Math.min(total, shown + LIST_PAGE))
}
