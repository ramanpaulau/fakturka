import { Download, Eye, EyeOff, Plus, Printer } from 'lucide-preact'
import { useEffect } from 'preact/hooks'
import { isNumberTaken } from '../domain/numbering'
import { Sheet, type SheetEditApi } from '../sheet/Sheet'
import { Button } from '../ui/Button'
import { bootEditor, printCurrent, saveCurrent, startNew } from './actions'
import {
  editorReady,
  invoice,
  isSaved,
  loadedNumber,
  setAmountFromInput,
  setDueDate,
  setField,
  setIssueDate,
  takenNumbers,
  toggleDic,
} from './editorState'

const editApi = (numberTaken: boolean): SheetEditApi => ({
  setField,
  setAmount: setAmountFromInput,
  setDate: (which, iso) => (which === 'issueDate' ? setIssueDate(iso) : setDueDate(iso)),
  numberTaken,
})

/** The Faktura tab: toolbar plus the A4 sheet edited in place. */
export function EditorPage() {
  useEffect(() => {
    void bootEditor()
  }, [])

  if (!editorReady.value) return null
  const inv = invoice.value
  const numberTaken = isNumberTaken(inv.number, takenNumbers.value) && inv.number !== loadedNumber.value

  return (
    <div class="editor">
      <div class="editor-toolbar controls">
        {!isSaved.value && <span class="unsaved">Neuloženo</span>}
        <Button icon={Plus} onClick={() => void startNew()}>
          Nová
        </Button>
        <Button icon={inv.showDic ? EyeOff : Eye} onClick={toggleDic}>
          {inv.showDic ? 'Skrýt DIČ' : 'Zobrazit DIČ'}
        </Button>
        <Button icon={Printer} onClick={() => void printCurrent()}>
          Tisknout
        </Button>
        <Button variant="primary" icon={Download} onClick={() => void saveCurrent()}>
          Uložit PDF
        </Button>
      </div>
      <div class="canvas">
        <Sheet invoice={inv} mode="edit" edit={editApi(numberTaken)} />
      </div>
    </div>
  )
}
