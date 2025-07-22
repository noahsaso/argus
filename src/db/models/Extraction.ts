import { AllowNull, Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({
  timestamps: true,
  indexes: [
    {
      fields: ['type'],
    },
  ],
})
export class Extraction extends Model {
  @AllowNull(false)
  @Column(DataType.STRING)
  declare type: string

  @AllowNull(false)
  @Column(DataType.JSON)
  declare data: Record<string, unknown>
}
