import type { Octokit } from 'octokit'

/**
 * Thin typed surface over Octokit for the PR lifecycle. All forge operations
 * are GitHub (Octokit) regardless of which issue tracker the repo uses.
 */

export type PrComment = { path: string; line: number; body: string }
export type ReviewVerdict = 'approved' | 'changes_requested'

export type PullRequestFile = { filename: string; patch?: string }

export interface GithubService {
  createDraftPR(input: {
    owner: string
    repo: string
    head: string
    base: string
    title: string
    body: string
  }): Promise<number>
  markPRReady(input: { owner: string; repo: string; prNumber: number }): Promise<void>
  mergePR(input: { owner: string; repo: string; prNumber: number }): Promise<void>
  listPRFiles(input: {
    owner: string
    repo: string
    prNumber: number
  }): Promise<PullRequestFile[]>
  createReview(input: {
    owner: string
    repo: string
    prNumber: number
    verdict: ReviewVerdict
    summary: string
    comments: PrComment[]
  }): Promise<void>
}

export function createGithubService(octokit: Octokit): GithubService {
  return {
    async createDraftPR({ owner, repo, head, base, title, body }) {
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        head,
        base,
        title,
        body,
        draft: true
      })
      return data.number
    },

    async markPRReady({ owner, repo, prNumber }) {
      const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })
      const prId = pr.data.node_id
      await octokit.graphql(
        `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }`,
        { id: prId }
      )
    },

    async mergePR({ owner, repo, prNumber }) {
      await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'squash'
      })
    },

    async listPRFiles({ owner, repo, prNumber }) {
      return octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100
      })
    },

    async createReview({ owner, repo, prNumber, verdict, summary, comments }) {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: verdict === 'approved' ? 'APPROVE' : 'REQUEST_CHANGES',
        body: summary || undefined,
        comments
      })
    }
  }
}
