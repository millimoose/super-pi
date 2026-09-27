import { describe, expect, it } from 'vitest'
import {
  EVENTS,
  IllegalTransition,
  STAGES,
  producingStageOfReview,
  transition,
  type Stage,
  type StageEvent
} from './stageMachine'

const LEGAL: Array<[Stage, StageEvent, Stage, boolean]> = [
  ['intake', 'start', 'brainstorming', false],
  // producing stages complete into their agent review
  ['brainstorming', 'stage_complete', 'spec_agent_review', false],
  ['planning', 'stage_complete', 'plan_agent_review', false],
  ['implementing', 'stage_complete', 'impl_agent_review', false],
  // agent review hands over to human review
  ['spec_agent_review', 'agent_review_complete', 'spec_human_review', false],
  ['plan_agent_review', 'agent_review_complete', 'plan_human_review', false],
  ['impl_agent_review', 'agent_review_complete', 'impl_human_review', false],
  // human approval advances the pipeline
  ['spec_human_review', 'human_approved', 'planning', false],
  ['plan_human_review', 'human_approved', 'implementing', false],
  ['impl_human_review', 'human_approved', 'landing', false],
  // rework edges: any review back to its producing stage
  ['spec_agent_review', 'changes_requested', 'brainstorming', true],
  ['spec_human_review', 'changes_requested', 'brainstorming', true],
  ['plan_agent_review', 'changes_requested', 'planning', true],
  ['plan_human_review', 'changes_requested', 'planning', true],
  ['impl_agent_review', 'changes_requested', 'implementing', true],
  ['impl_human_review', 'changes_requested', 'implementing', true],
  // landing
  ['landing', 'landed', 'done', false]
]

describe('transition legal table', () => {
  it.each(LEGAL)('%s --%s--> %s (rework=%s)', (stage, event, next, rework) => {
    expect(transition(stage, event)).toEqual({ stage: next, rework })
  })
})

describe('transition rejects everything else', () => {
  it('throws IllegalTransition for every unlisted combination', () => {
    let illegalCount = 0
    for (const stage of STAGES) {
      for (const event of EVENTS) {
        const listed = LEGAL.some(([s, e]) => s === stage && e === event)
        if (listed) continue
        illegalCount++
        expect(() => transition(stage, event)).toThrow(IllegalTransition)
      }
    }
    // sanity: the table above is a strict subset of the full product
    expect(illegalCount).toBe(STAGES.length * EVENTS.length - LEGAL.length)
  })

  it('terminal stage done accepts nothing', () => {
    for (const event of EVENTS) {
      expect(() => transition('done', event)).toThrow(IllegalTransition)
    }
  })
})

describe('producingStageOfReview', () => {
  it('maps each review stage to its producer', () => {
    expect(producingStageOfReview('spec_agent_review')).toBe('brainstorming')
    expect(producingStageOfReview('spec_human_review')).toBe('brainstorming')
    expect(producingStageOfReview('plan_human_review')).toBe('planning')
    expect(producingStageOfReview('impl_human_review')).toBe('implementing')
    expect(producingStageOfReview('brainstorming')).toBeNull()
    expect(producingStageOfReview('landing')).toBeNull()
    expect(producingStageOfReview('done')).toBeNull()
  })
})

describe('happy path walk', () => {
  it('reaches done via the full pipeline', () => {
    let stage: Stage = 'intake'
    const fire = (event: StageEvent): Stage => transition(stage, event).stage
    stage = fire('start')
    stage = fire('stage_complete')
    stage = fire('agent_review_complete')
    stage = fire('human_approved')
    stage = fire('stage_complete')
    stage = fire('agent_review_complete')
    stage = fire('human_approved')
    stage = fire('stage_complete')
    stage = fire('agent_review_complete')
    stage = fire('human_approved')
    stage = fire('landed')
    expect(stage).toBe('done')
  })

  it('rework returns to the same stage the pipeline came from', () => {
    // spec path: brainstorming -> spec_agent_review, rework lands back on brainstorming
    const mid = transition('brainstorming', 'stage_complete').stage
    expect(transition(mid, 'changes_requested')).toEqual({ stage: 'brainstorming', rework: true })
  })
})
