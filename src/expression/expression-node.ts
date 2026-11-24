/** Where a node stands in its text: the offset of its first character and the one after its last. */
export type ExpressionSpan = [number, number];

/** An operator between two values. `||`, `&&` are written as `or`, `and`; `not in` as `notIn`. */
export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or' | '??' | 'in' | 'notIn';

/** An operator before a value. `!` is written as `not`. */
export type UnaryOperator = '-' | 'not';

/**
 * A value written as it is. A day's `value` is `YYYY-MM-DD`; a moment's is `YYYY-MM-DDTHH:MM:SS`, with `Z` or an offset
 * when it names one, else it is read in the time zone of the evaluation.
 */
export interface LiteralNode {
  kind: 'literal';
  value: number | string | boolean | null;
  type?: 'date' | 'datetime';
  at: ExpressionSpan;
}

/** A name the expression is given (`steps`), or a parameter of the short function it is in (`r`). */
export interface NameNode {
  kind: 'name';
  name: string;
  at: ExpressionSpan;
}

/** A field of a value: `a.b`, or `a?.b`, which gives `null` when `a` is `null`. */
export interface MemberNode {
  kind: 'member';
  object: ExpressionNode;
  name: string;
  optional: boolean;
  at: ExpressionSpan;
}

/** An item of a list or a field named by a value: `a[0]`, `a['name']`, or `a?.[0]`. */
export interface IndexNode {
  kind: 'index';
  object: ExpressionNode;
  index: ExpressionNode;
  optional: boolean;
  at: ExpressionSpan;
}

/** A function of the library, by its name. */
export interface CallNode {
  kind: 'call';
  name: string;
  args: ExpressionNode[];
  at: ExpressionSpan;
}

/** A short function, written as an argument: `r => r.total`, `(a, b) => a + b`. */
export interface LambdaNode {
  kind: 'lambda';
  params: string[];
  body: ExpressionNode;
  at: ExpressionSpan;
}

export interface UnaryNode {
  kind: 'unary';
  op: UnaryOperator;
  operand: ExpressionNode;
  at: ExpressionSpan;
}

export interface BinaryNode {
  kind: 'binary';
  op: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
  at: ExpressionSpan;
}

/** `test ? then : else`: only the side chosen is worked out. */
export interface ConditionalNode {
  kind: 'conditional';
  test: ExpressionNode;
  then: ExpressionNode;
  else: ExpressionNode;
  at: ExpressionSpan;
}

export interface ListNode {
  kind: 'list';
  items: ExpressionNode[];
  at: ExpressionSpan;
}

export interface ObjectNode {
  kind: 'object';
  entries: { key: string; value: ExpressionNode }[];
  at: ExpressionSpan;
}

/** A text with expressions in it (`Hello {{ item.name }}`): its plain parts as text, the others as nodes. */
export interface TemplateNode {
  kind: 'template';
  parts: (string | ExpressionNode)[];
  at: ExpressionSpan;
}

/** A node of an expression's tree: plain data, kept and sent as JSON. */
export type ExpressionNode =
  | LiteralNode
  | NameNode
  | MemberNode
  | IndexNode
  | CallNode
  | LambdaNode
  | UnaryNode
  | BinaryNode
  | ConditionalNode
  | ListNode
  | ObjectNode
  | TemplateNode;

/** An expression as it is kept: its text, and its tree, which a reader takes without reading the text again. */
export interface ExpressionTree {
  version: 1;
  source: string;
  root: ExpressionNode;
}
