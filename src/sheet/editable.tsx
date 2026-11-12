import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { DatePopover } from './DatePopover'
import { ChangedFields } from './sectionContext'

/** contentEditable text as a field value: one line, ordinary spaces (browsers insert NBSPs to keep spaces visible). */
const clean = (s: string) => s.replace(/\r\n?|\n/g, ' ').replace(/ /g, ' ')

/** Inserts plain text at the caret: execCommand keeps the browser's undo stack and fires `input`; the fallback does it by hand. */
function insertPlainText(el: HTMLElement, text: string): boolean {
  try {
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return true
  } catch {
    // not supported: fall through
  }
  const sel = window.getSelection()
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  if (range && el.contains(range.commonAncestorContainer)) {
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    sel!.removeAllRanges()
    sel!.addRange(range)
  } else {
    el.append(text)
  }
  return false
}

function caretToEnd(el: HTMLElement) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

export type EditableProps = {
  /** data-field, used by tests and Task 10's section logic */
  field: string
  /** Text shown while the field is not focused. */
  value: string
  /** Text shown while focused, when it differs from the display (the raw amount). */
  editValue?: string
  label: string
  /** Hint shown in an empty field on screen only. */
  placeholder: string
  /** A warning about the value (e.g. a bad IČO checksum): shown next to the field on screen only; never blocks. */
  invalid?: string
  onCommit: (text: string) => void
}

/**
 * An in-place plain-text field on the paper. The DOM text is owned here, not by Preact: it is written only while the
 * field is not focused, so re-renders caused by typing never move the caret. Commits on every input and, trimmed, on blur.
 */
export function Editable({ field, value, editValue, label, placeholder, invalid, onCommit }: EditableProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const focused = useRef(false)
  const [, rerender] = useState(0)
  const changed = useContext(ChangedFields).has(field)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && !focused.current && el.textContent !== value) el.textContent = value
  })

  const text = () => clean(ref.current?.textContent ?? '')

  return (
    <span
      ref={ref}
      class="ed"
      contentEditable="true"
      role="textbox"
      aria-label={label}
      aria-multiline="false"
      data-field={field}
      data-changed={changed ? '' : undefined}
      data-ph={placeholder}
      data-invalid={invalid}
      aria-invalid={invalid ? true : undefined}
      title={invalid}
      spellcheck={false}
      onFocus={() => {
        focused.current = true
        const el = ref.current!
        if (editValue !== undefined && el.textContent !== editValue) {
          el.textContent = editValue
          caretToEnd(el)
        }
      }}
      onInput={() => {
        const el = ref.current!
        // Browsers leave a <br> behind when the last character is deleted; drop it so :empty shows the hint.
        if (el.textContent === '' && el.innerHTML !== '') el.innerHTML = ''
        onCommit(text())
      }}
      onBlur={() => {
        focused.current = false
        onCommit(text().trim())
        // Re-render even when the value did not change, so the display text (e.g. the formatted amount) comes back.
        rerender((n) => n + 1)
      }}
      onKeyDown={(e) => {
        if (e.isComposing || e.keyCode === 229) return // IME / dead-key composition: Enter confirms it (229: WebKit after compositionend)
        if (e.key === 'Enter') {
          e.preventDefault()
          ref.current!.blur()
        } else if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault() // no rich-text formatting
        }
      }}
      onBeforeInput={(e) => {
        const t = (e as InputEvent).inputType ?? ''
        if (t.startsWith('format') || t === 'insertParagraph' || t === 'insertLineBreak' || t === 'insertFromDrop') e.preventDefault()
      }}
      onPaste={(e) => {
        e.preventDefault()
        const el = ref.current!
        // Only the plain-text flavour, on one line; execCommand fires `input` itself, the fallback commits here.
        if (!insertPlainText(el, clean(e.clipboardData?.getData('text/plain') ?? ''))) onCommit(text())
      }}
      onDrop={(e) => e.preventDefault()}
    />
  )
}

/** A date on the paper that opens the Czech calendar. Focus stays here; the calendar is driven from the keyboard. */
export function DateField(props: { label: string; value: string; text: string; onSelect: (iso: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <span
        ref={ref}
        class="ed date"
        role="button"
        tabIndex={0}
        aria-label={`${props.label}: ${props.text}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          // Focus moved to another field: close, so the calendar's document key listeners stop capturing its keys.
          // A null target (click on a non-focusable spot) is left to the Popover's outside-click handling.
          const to = e.relatedTarget as Element | null
          if (open && to && !to.closest('.cal')) setOpen(false)
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === ' ') e.preventDefault() // no page scroll; the open Popover handles the other keys
            return
          }
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {props.text}
      </span>
      <DatePopover
        anchor={ref}
        open={open}
        value={props.value}
        onSelect={(iso) => {
          props.onSelect(iso)
          ref.current?.focus()
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
