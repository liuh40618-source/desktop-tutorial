// Node 22 内置的 node:sqlite 在 @types/node@20 里还没有类型声明，
// 这里只声明本产品用到的子集，足够 tsc 通过、运行时由 Node 22 提供实现。
declare module "node:sqlite" {
  export interface Statement {
    run(...params: any[]): unknown;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
