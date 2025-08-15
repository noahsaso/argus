/**
 * Database query profiling utility for measuring execution time
 */

interface QueryProfile {
  query: string
  executionTime: number
  timestamp: Date
  context?: string
}

export class QueryProfiler {
  private static profiles: QueryProfile[] = []
  private static isEnabled = process.env.ENABLE_QUERY_PROFILING === 'true'

  /**
   * Profile a database query operation
   */
  static async profileQuery<T>(
    operation: () => Promise<T>,
    queryDescription: string,
    context?: string
  ): Promise<T> {
    if (!this.isEnabled) {
      return operation()
    }

    const startTime = performance.now()
    try {
      const result = await operation()
      const endTime = performance.now()
      const executionTime = endTime - startTime

      this.profiles.push({
        query: queryDescription,
        executionTime,
        timestamp: new Date(),
        context,
      })

      console.log(
        `[QUERY PROFILE] ${queryDescription} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms`
      )

      return result
    } catch (error) {
      const endTime = performance.now()
      const executionTime = endTime - startTime

      console.log(
        `[QUERY PROFILE ERROR] ${queryDescription} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms - ${error}`
      )

      throw error
    }
  }

  /**
   * Profile a synchronous operation
   */
  static profileSync<T>(
    operation: () => T,
    operationDescription: string,
    context?: string
  ): T {
    if (!this.isEnabled) {
      return operation()
    }

    const startTime = performance.now()
    try {
      const result = operation()
      const endTime = performance.now()
      const executionTime = endTime - startTime

      console.log(
        `[OPERATION PROFILE] ${operationDescription} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms`
      )

      return result
    } catch (error) {
      const endTime = performance.now()
      const executionTime = endTime - startTime

      console.log(
        `[OPERATION PROFILE ERROR] ${operationDescription} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms - ${error}`
      )

      throw error
    }
  }

  /**
   * Get all query profiles
   */
  static getProfiles(): QueryProfile[] {
    return [...this.profiles]
  }

  /**
   * Clear all query profiles
   */
  static clearProfiles(): void {
    this.profiles = []
  }

  /**
   * Get profiling statistics
   */
  static getStats(): {
    totalQueries: number
    averageTime: number
    slowestQuery: QueryProfile | null
    fastestQuery: QueryProfile | null
  } {
    if (this.profiles.length === 0) {
      return {
        totalQueries: 0,
        averageTime: 0,
        slowestQuery: null,
        fastestQuery: null,
      }
    }

    const totalTime = this.profiles.reduce(
      (sum, profile) => sum + profile.executionTime,
      0
    )
    const averageTime = totalTime / this.profiles.length

    const slowestQuery = this.profiles.reduce((slowest, current) =>
      current.executionTime > slowest.executionTime ? current : slowest
    )

    const fastestQuery = this.profiles.reduce((fastest, current) =>
      current.executionTime < fastest.executionTime ? current : fastest
    )

    return {
      totalQueries: this.profiles.length,
      averageTime,
      slowestQuery,
      fastestQuery,
    }
  }

  /**
   * Enable or disable profiling
   */
  static setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
  }

  /**
   * Check if profiling is enabled
   */
  static isProfilingEnabled(): boolean {
    return this.isEnabled
  }
}
