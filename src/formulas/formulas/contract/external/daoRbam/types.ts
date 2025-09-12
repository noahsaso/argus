export interface Assignment {
  addr: string
  role_id: number
}

export interface Role {
  id: number
  enabled: boolean
  name: string
  metadata: string | null
}
