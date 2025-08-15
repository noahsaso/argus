type Source = {
  /**
   * The code ID keys to match.
   */
  codeIdKeys: string[]
  /**
   * The wasm event attributes to match.
   */
  attributes: {
    /**
     * The key to match.
     */
    key: string
    /**
     * The value to match.
     */
    value: string | string[]
    /**
     * Other attributes to ensure are present.
     */
    otherAttributes?: string[]
  }[]
}
