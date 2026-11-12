import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { emptySavedData } from '../storage/dataStore'
import { getBackend, MemoryBackend } from '../storage/backend'
import { currentTab, savedData } from './state'
import { TopBar } from './TopBar'

const backend = () => getBackend() as MemoryBackend

beforeEach(() => {
  backend().dataFile = null
  backend().bakFile = null
  currentTab.value = 'faktura'
  savedData.value = emptySavedData()
})
afterEach(cleanup)

describe('TopBar', () => {
  it('renders logo, the three tabs and the settings button', () => {
    render(<TopBar />)
    expect(screen.getByText('Fakturka', { selector: '.logo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Faktura' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Historie' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uložené údaje' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nastavení' })).toBeInTheDocument()
  })

  it('clicking a tab switches currentTab', () => {
    render(<TopBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Historie' }))
    expect(currentTab.value).toBe('historie')
    fireEvent.click(screen.getByRole('button', { name: 'Uložené údaje' }))
    expect(currentTab.value).toBe('udaje')
    fireEvent.click(screen.getByRole('button', { name: 'Nastavení' }))
    expect(currentTab.value).toBe('nastaveni')
  })

  it('marks the active tab', () => {
    currentTab.value = 'historie'
    render(<TopBar />)
    expect(screen.getByRole('button', { name: 'Historie' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Faktura' })).not.toHaveAttribute('aria-current')
  })

  it('theme button offers the opposite of the shown theme (system resolves to light in jsdom)', () => {
    render(<TopBar />)
    expect(screen.getByTitle('Přepnout na tmavý motiv')).toBeInTheDocument()
    expect(screen.queryByTitle(/Systém/)).toBeNull()
  })

  it('theme button toggles light <-> dark and persists it', async () => {
    render(<TopBar />)
    fireEvent.click(screen.getByTitle('Přepnout na tmavý motiv'))
    await waitFor(() => expect(JSON.parse(backend().dataFile ?? 'null')?.settings.theme).toBe('dark'))
    expect(savedData.value?.settings.theme).toBe('dark')

    fireEvent.click(await screen.findByTitle('Přepnout na světlý motiv'))
    await waitFor(() => expect(JSON.parse(backend().dataFile ?? 'null')?.settings.theme).toBe('light'))
    fireEvent.click(await screen.findByTitle('Přepnout na tmavý motiv'))
    await waitFor(() => expect(JSON.parse(backend().dataFile ?? 'null')?.settings.theme).toBe('dark'))
  })
})
