import { reactive } from '@motifx/core';

/**
 * The data layer reports changes through events, not reactive state. A view reads it through `read`;
 * `changed`, given to those events, makes every such read run again.
 */
export class Follow {
  private readonly state = reactive({ version: 0 });

  readonly changed = () => {
    this.state.version++;
  };

  read<R>(value: () => R): R {
    void this.state.version;
    return value();
  }
}
