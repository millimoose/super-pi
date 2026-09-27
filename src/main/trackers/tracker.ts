/** One issue in a pluggable tracker. `id` is the tracker's stable string id. */
export type TrackerIssue = { id: string; title: string; url: string; body: string }

export type NewIssue = { title: string; body: string }

/**
 * Issue-tracker abstraction. GitHub today; Linear later satisfies the same
 * interface. PR operations are NOT part of this interface — those stay
 * forge-side (see src/main/github/githubService.ts).
 */
export interface IssueTracker {
  listOpen(): Promise<TrackerIssue[]>
  get(id: string): Promise<TrackerIssue>
  create(input: NewIssue): Promise<TrackerIssue>
}

export class UnsupportedTrackerError extends Error {
  constructor(public readonly remoteUrl: string) {
    super(`unsupported issue tracker for remote "${remoteUrl}" (only github.com is supported)`)
    this.name = 'UnsupportedTrackerError'
  }
}
