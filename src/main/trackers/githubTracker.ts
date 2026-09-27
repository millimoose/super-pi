import type { Octokit } from 'octokit'
import type { IssueTracker, NewIssue, TrackerIssue } from './tracker'

type RestIssue = {
  number: number
  title: string
  html_url: string
  body?: string | null
  pull_request?: unknown
}

function toTrackerIssue(issue: RestIssue): TrackerIssue {
  return {
    id: String(issue.number),
    title: issue.title,
    url: issue.html_url,
    body: issue.body ?? ''
  }
}

/** Minimal structural surface of Octokit the tracker touches — stubbed in tests. */
export type GithubIssuesApi = {
  rest: {
    issues: {
      listForRepo(params: {
        owner: string
        repo: string
        state: 'open'
        per_page?: number
      }): Promise<{ data: RestIssue[] }>
      get(params: {
        owner: string
        repo: string
        issue_number: number
      }): Promise<{ data: RestIssue }>
      create(params: {
        owner: string
        repo: string
        title: string
        body: string
      }): Promise<{ data: RestIssue }>
    }
  }
}

export function createGithubTracker(
  api: GithubIssuesApi,
  owner: string,
  repo: string
): IssueTracker {
  return {
    async listOpen() {
      const { data } = await api.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: 100
      })
      return data.filter((i) => i.pull_request === undefined).map(toTrackerIssue)
    },

    async get(id) {
      const { data } = await api.rest.issues.get({
        owner,
        repo,
        issue_number: Number(id)
      })
      return toTrackerIssue(data)
    },

    async create({ title, body }: NewIssue) {
      const { data } = await api.rest.issues.create({ owner, repo, title, body })
      return toTrackerIssue(data)
    }
  }
}

/** Convenience for the wired path: an Octokit instance satisfies GithubIssuesApi. */
export function octokitAsIssuesApi(octokit: Octokit): GithubIssuesApi {
  return octokit
}
