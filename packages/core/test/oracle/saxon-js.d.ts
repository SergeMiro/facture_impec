// The parts of SaxonJS 2.7 the oracle uses. The package ships no types (docs/research/FORMATS.md §2.2).
declare module 'saxon-js' {
  interface SaxonNode {
    getAttribute(name: string): string | null;
  }
  interface TransformOptions {
    stylesheetInternal: object;
    stylesheetBaseURI?: string;
    sourceNode: unknown;
    destination: 'document';
  }
  interface XPathOptions {
    namespaceContext?: Record<string, string>;
    resultForm?: 'array';
  }
  const SaxonJS: {
    getResource(options: { text: string; type: 'xml' }): Promise<unknown>;
    transform(options: TransformOptions, mode: 'async'): Promise<{ principalResult: unknown }>;
    XPath: { evaluate(xpath: string, context: unknown, options?: XPathOptions): unknown };
    getProcessorInfo(): { productVersion: string };
  };
  export default SaxonJS;
}
