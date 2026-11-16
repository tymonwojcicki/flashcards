// Prop contract: { tab?: 'general' | 'scheduling' | 'data'; deckId?: string (deck whose preset to edit) }
import { useEffect, useState } from 'react'
import { Segmented } from '@renderer/features/settings/common'
import { GeneralTab } from '@renderer/features/settings/GeneralTab'
import { SchedulingTab } from '@renderer/features/settings/SchedulingTab'
import { DataTab } from '@renderer/features/settings/DataTab'

type Tab = 'general' | 'scheduling' | 'data'

export default function SettingsPage({ tab, deckId }: { tab?: Tab; deckId?: string }): React.JSX.Element {
  const [current, setCurrent] = useState<Tab>(tab ?? (deckId ? 'scheduling' : 'general'))
  useEffect(() => {
    if (tab) setCurrent(tab)
  }, [tab])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Segmented<Tab>
          label="Settings section"
          value={current}
          onChange={setCurrent}
          options={[
            { value: 'general', label: 'General' },
            { value: 'scheduling', label: 'Scheduling' },
            { value: 'data', label: 'Data' }
          ]}
        />
      </header>
      {current === 'general' && <GeneralTab />}
      {current === 'scheduling' && <SchedulingTab deckId={deckId} />}
      {current === 'data' && <DataTab />}
    </div>
  )
}
