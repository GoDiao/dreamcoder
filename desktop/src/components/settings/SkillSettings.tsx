import { useState } from 'react'
import { useSkillStore } from '../../stores/skillStore'
import { SkillList } from '../skills/SkillList'
import { SkillDetail } from '../skills/SkillDetail'

export function SkillSettings() {
  const selectedSkill = useSkillStore((s) => s.selectedSkill)
  const [query, setQuery] = useState('')

  if (selectedSkill) {
    return (
      <div className="w-full min-w-0">
        <SkillDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <SkillList query={query} onQueryChange={setQuery} />
    </div>
  )
}
