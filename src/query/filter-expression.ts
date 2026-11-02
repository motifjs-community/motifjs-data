import type { FilterCondition } from './filter-condition';

/** Plain data, so it can be stored, sent, and translated into each backend's query language. */
export type FilterExpression = FilterCondition | { and: FilterExpression[] } | { or: FilterExpression[] } | { not: FilterExpression };
