import {
  AllowNull,
  Column,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript'

import { WasmCodeService } from '@/services/wasm-codes'
import { ContractJson } from '@/types'

@Table({
  timestamps: true,
})
export class Contract extends Model {
  @PrimaryKey
  @Column(DataType.STRING)
  declare address: string

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare codeId: number

  @AllowNull
  @Column(DataType.TEXT)
  declare admin: string | null

  @AllowNull
  @Column(DataType.TEXT)
  declare creator: string | null

  @AllowNull
  @Column(DataType.TEXT)
  declare label: string | null

  @AllowNull
  @Column(DataType.BIGINT)
  declare instantiatedAtBlockHeight: string | null

  @AllowNull
  @Column(DataType.BIGINT)
  declare instantiatedAtBlockTimeUnixMs: string | null

  @AllowNull
  @Column(DataType.DATE)
  declare instantiatedAtBlockTimestamp: Date | null

  @AllowNull
  @Column(DataType.TEXT)
  declare txHash: string | null

  get json(): ContractJson {
    return {
      address: this.address,
      codeId: this.codeId,
      admin: this.admin,
      creator: this.creator,
      label: this.label,
      instantiatedAt:
        this.instantiatedAtBlockHeight &&
        this.instantiatedAtBlockTimeUnixMs &&
        this.instantiatedAtBlockTimestamp
          ? {
              height: this.instantiatedAtBlockHeight,
              timeUnixMs: this.instantiatedAtBlockTimeUnixMs,
              timestamp: this.instantiatedAtBlockTimestamp.toISOString(),
            }
          : null,
      txHash: this.txHash,
    }
  }

  /**
   * Return whether or not the contract matches a given set of code IDs keys
   * from the config.
   */
  matchesCodeIdKeys(...keys: string[]): boolean {
    return WasmCodeService.instance.matchesWasmCodeKeys(this.codeId, ...keys)
  }
}
