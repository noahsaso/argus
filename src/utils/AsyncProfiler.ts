/**
 * Profiling utility for measuring execution time
 */
interface Profile {
  description: string
  executionTime: number
  timestamp: Date
  context?: string
}

export class AsyncProfiler {
  private static profiles: Profile[] = []
  private static isEnabled = process.env.ENABLE_PROFILING === 'true'

  /**
   * Profile an async operation
   */
  static async profile<T>(
    operation: () => Promise<T>,
    description: string,
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
        description,
        executionTime,
        timestamp: new Date(),
        context,
      })

      console.log(
        `[PROFILER] ${description} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms`
      )

      return result
    } catch (error) {
      const endTime = performance.now()
      const executionTime = endTime - startTime

      console.log(
        `[PROFILER ERROR] ${description} (${
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
    description: string,
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
        `[PROFILER] ${description} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms`
      )

      return result
    } catch (error) {
      const endTime = performance.now()
      const executionTime = endTime - startTime

      console.log(
        `[PROFILER ERROR] ${description} (${
          context || 'unknown context'
        }) - ${executionTime.toFixed(2)}ms - ${error}`
      )

      throw error
    }
  }

  /**
   * Get all profiles
   */
  static getProfiles(): Profile[] {
    return [...this.profiles]
  }

  /**
   * Clear all profiles
   */
  static clearProfiles(): void {
    this.profiles = []
  }

  /**
   * Get profiling statistics
   */
  static getStats(): {
    totalExecutions: number
    averageTime: number
    slowestExecution: Profile | null
    fastestExecution: Profile | null
  } {
    if (this.profiles.length === 0) {
      return {
        totalExecutions: 0,
        averageTime: 0,
        slowestExecution: null,
        fastestExecution: null,
      }
    }

    const totalTime = this.profiles.reduce(
      (sum, profile) => sum + profile.executionTime,
      0
    )
    const averageTime = totalTime / this.profiles.length

    const slowestExecution = this.profiles.reduce((slowest, current) =>
      current.executionTime > slowest.executionTime ? current : slowest
    )

    const fastestExecution = this.profiles.reduce((fastest, current) =>
      current.executionTime < fastest.executionTime ? current : fastest
    )

    return {
      totalExecutions: this.profiles.length,
      averageTime,
      slowestExecution,
      fastestExecution,
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
