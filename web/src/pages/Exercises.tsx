import { useState } from 'react'
import { navigate } from '../router'
import { PageHeader } from '../ui/components'
import { CustomExerciseSheet, ExerciseList } from './ExercisePicker'

export function Exercises() {
  const [creating, setCreating] = useState<string>()
  return (
    <>
      <PageHeader title="Exercises" />
      <div style={{ marginTop: 12 }}>
        <ExerciseList onPick={(e) => navigate(`/progress/exercise/${e.id}`)} onCreate={setCreating} />
      </div>
      {creating !== undefined && <CustomExerciseSheet initialName={creating} onClose={() => setCreating(undefined)} />}
    </>
  )
}
