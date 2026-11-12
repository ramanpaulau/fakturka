import type { ComponentChildren, JSX } from 'preact'
import type { LucideIcon } from 'lucide-preact'

export type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: LucideIcon
  children?: ComponentChildren
}

/** 32 px high. Default variant is secondary. */
export function Button({ variant = 'secondary', icon: Icon, children, class: cls, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} class={['btn', `btn-${variant}`, cls].filter(Boolean).join(' ')} {...rest}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  )
}
