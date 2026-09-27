/**
 * Stage machine for the superpowers workflow enforced per task.
 *
 * intake -> brainstorming -> spec_agent_review -> spec_human_review
 *        -> planning -> plan_agent_review -> plan_human_review
 *        -> implementing -> impl_agent_review -> impl_human_review
 *        -> landing -> done
 * Any *_review --changes_requested--> its producing stage (rework).
 */

export const STAGES = [
  'intake',
  'brainstorming',
  'spec_agent_review',
  'spec_human_review',
  'planning',
  'plan_agent_review',
  'plan_human_review',
  'implementing',
  'impl_agent_review',
  'impl_human_review',
  'landing',
  'done'
] as const

export type Stage = (typeof STAGES)[number]

export const EVENTS = [
  'start',
  'stage_complete',
  'agent_review_complete',
  'human_approved',
  'changes_requested',
  'landed'
] as const

export type StageEvent = (typeof EVENTS)[number]

export class IllegalTransition extends Error {
  constructor(stage: Stage, event: StageEvent) {
    super(`illegal transition: stage "${stage}" does not accept event "${event}"`)
    this.name = 'IllegalTransition'
  }
}

/** Stages that produce an artifact, mapped to their review stages and artifact kind. */
export const PRODUCING = {
  brainstorming: { agentReview: 'spec_agent_review', humanReview: 'spec_human_review', kind: 'spec' },
  planning: { agentReview: 'plan_agent_review', humanReview: 'plan_human_review', kind: 'plan' },
  implementing: { agentReview: 'impl_agent_review', humanReview: 'impl_human_review', kind: 'implementation' }
} as const satisfies Record<string, { agentReview: Stage; humanReview: Stage; kind: string }>

export type ProducingStage = keyof typeof PRODUCING

export function isProducingStage(stage: Stage): stage is ProducingStage {
  return stage in PRODUCING
}

/** The producing stage whose artifact a review stage examines. */
export function producingStageOfReview(stage: Stage): ProducingStage | null {
  for (const [producing, info] of Object.entries(PRODUCING)) {
    if (info.agentReview === stage || info.humanReview === stage) return producing as ProducingStage
  }
  return null
}

export interface TransitionResult {
  stage: Stage
  /** true when the transition was caused by a changes_requested event (rework loop) */
  rework: boolean
}

const HAPPY_HUMAN_APPROVED: Partial<Record<Stage, Stage>> = {
  spec_human_review: 'planning',
  plan_human_review: 'implementing',
  impl_human_review: 'landing'
}

export function transition(stage: Stage, event: StageEvent): TransitionResult {
  switch (event) {
    case 'start':
      if (stage === 'intake') return { stage: 'brainstorming', rework: false }
      break
    case 'stage_complete':
      if (isProducingStage(stage)) return { stage: PRODUCING[stage].agentReview, rework: false }
      break
    case 'agent_review_complete': {
      const producer = producingStageOfReview(stage)
      if (producer && PRODUCING[producer].agentReview === stage) {
        return { stage: PRODUCING[producer].humanReview, rework: false }
      }
      break
    }
    case 'human_approved': {
      const next = HAPPY_HUMAN_APPROVED[stage]
      if (next) return { stage: next, rework: false }
      break
    }
    case 'changes_requested': {
      const producer = producingStageOfReview(stage)
      if (producer) return { stage: producer, rework: true }
      break
    }
    case 'landed':
      if (stage === 'landing') return { stage: 'done', rework: false }
      break
  }
  throw new IllegalTransition(stage, event)
}
