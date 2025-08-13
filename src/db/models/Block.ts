import { Op } from 'sequelize'
import {
  AllowNull,
  Column,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript'

import { Block as BlockType } from '@/types'

@Table({
  timestamps: true,
  indexes: [
    {
      fields: ['height'],
    },
    {
      fields: ['timeUnixMs'],
    },
  ],
})
export class Block extends Model {
  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare height: string

  @AllowNull(false)
  @Column(DataType.BIGINT)
  declare timeUnixMs: string

  @AllowNull(false)
  @Column(DataType.DATE)
  declare timestamp: Date

  get block(): BlockType {
    return {
      height: BigInt(this.height),
      timeUnixMs: BigInt(this.timeUnixMs),
    }
  }

  /**
   * Create or update a block.
   */
  static async createOne(block: {
    height: string | number | bigint
    timeUnixMs: string | number | bigint
  }): Promise<Block> {
    return (
      await Block.upsert({
        height: BigInt(block.height).toString(),
        timeUnixMs: BigInt(block.timeUnixMs).toString(),
        timestamp: new Date(Number(block.timeUnixMs)),
      })
    )[0]
  }

  /**
   * Create or update multiple blocks.
   */
  static async createMany(
    blocks: {
      height: string | number | bigint
      timeUnixMs: string | number | bigint
    }[]
  ): Promise<Block[]> {
    if (blocks.length === 0) {
      return []
    }

    return await Block.bulkCreate(
      blocks.map((block) => ({
        height: BigInt(block.height).toString(),
        timeUnixMs: BigInt(block.timeUnixMs).toString(),
        timestamp: new Date(Number(block.timeUnixMs)),
      })),
      {
        updateOnDuplicate: ['timeUnixMs', 'timestamp'],
        conflictAttributes: ['height'],
      }
    )
  }

  /**
   * Get the latest block before or equal to the requested block height.
   */
  static async getForHeight(
    blockHeight: string | number | bigint,
    // Optionally set a minimum.
    after: string | number | bigint = 0
  ): Promise<Block | null> {
    return await Block.findOne({
      where: {
        height: {
          [Op.gt]: after,
          [Op.lte]: blockHeight,
        },
      },
      order: [['height', 'DESC']],
    })
  }

  /**
   * Get the latest block before or equal to the requested block time.
   */
  static async getForTime(
    blockTimeUnixMs: string | number | bigint,
    // Optionally set a minimum.
    after: string | number | bigint = 0
  ): Promise<Block | null> {
    return await Block.findOne({
      where: {
        timeUnixMs: {
          [Op.gt]: after,
          [Op.lte]: blockTimeUnixMs,
        },
      },
      order: [['timeUnixMs', 'DESC']],
    })
  }

  /**
   * Get the first block.
   */
  static async getFirst(): Promise<Block | null> {
    return await Block.findOne({
      where: {
        height: {
          [Op.gt]: 0,
        },
      },
      order: [['height', 'ASC']],
    })
  }

  /**
   * Get the last block.
   */
  static async getLast(): Promise<Block | null> {
    return await Block.findOne({
      where: {
        height: {
          [Op.gt]: 0,
        },
      },
      order: [['height', 'DESC']],
    })
  }
}
