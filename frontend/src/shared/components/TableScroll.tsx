import type { ReactNode } from 'react'

type TableScrollProps = {
  children: ReactNode
}

export function TableScroll({ children }: TableScrollProps) {
  return <div className="table-scroll">{children}</div>
}
