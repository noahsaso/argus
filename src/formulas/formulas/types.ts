export type Expiration =
  | {
      at_height: number
    }
  | {
      at_time: string
    }
  | {
      never: {}
    }

export type Duration =
  | {
      height: number
    }
  | {
      time: number
    }

export interface ContractInfo {
  contract: string
  version: string
}

export type Denom =
  | {
      native: string
    }
  | {
      cw20: string
    }

export interface ProposalModule {
  address: string
  prefix: string
  // v2 changed case.
  status: 'enabled' | 'Enabled' | 'disabled' | 'Disabled'
}

export type VoteCast<Vote = any> = {
  voter: string
  vote: Vote
  votedAt?: string
}

export type VoteInfo<Vote = any> = Omit<VoteCast, 'vote'> & Vote

export type VotingPowerAtHeight = {
  power: string
  height: number
}

export type TotalPowerAtHeight = VotingPowerAtHeight
