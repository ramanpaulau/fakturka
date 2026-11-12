import type { JSX } from 'preact'
import type { LucideIcon } from 'lucide-preact'

export type IconButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'title'> & {
  icon: LucideIcon
  /** Tooltip and accessible name. */
  title: string
  active?: boolean
}

/** 32 x 32 icon-only button. */
export function IconButton({ icon: Icon, title, active, class: cls, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} title={title} aria-label={title} class={['ib', active && 'on', cls].filter(Boolean).join(' ')} {...rest}>
      <Icon size={16} />
    </button>
  )
}
