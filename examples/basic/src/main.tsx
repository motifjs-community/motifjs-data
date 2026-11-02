import '@motifx-community/design-system/styles.css';
import './demo.css';
import { Application, Component, reactive } from '@motifx/core';
import { EditingSection } from './sections/editing-section';
import { LookupSection } from './sections/lookup-section';
import { MemorySection } from './sections/memory-section';
import { ODataSection } from './sections/odata-section';
import { RestSection } from './sections/rest-section';
import { VirtualSection } from './sections/virtual-section';
import { WcfSection } from './sections/wcf-section';

const TABS = [
  { id: 'memory', title: 'Memory', note: 'ArrayAdapter · 100,000 rows' },
  { id: 'odata', title: 'OData', note: 'Northwind · query on the service' },
  { id: 'lookup', title: 'Lookup', note: 'search, a value off the page' },
  { id: 'virtual', title: 'Virtual list', note: 'blocks where the view is' },
  { id: 'rest', title: 'REST', note: 'DummyJSON' },
  { id: 'editing', title: 'Editing', note: 'ChangeTracker · TripPin, etags' },
  { id: 'wcf', title: 'WCF', note: 'SOAP · local service' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const ui = reactive({ tab: 'memory' as TabId });

// A tab is built when it is first opened and kept afterwards, with its loaded rows.
class Demo extends Component<HTMLDivElement> {
  override onConfigured() {
    this.class.add('demo');
  }

  override view() {
    return (
      <>
        <header class="demo-head">
          <h1>@motifx-community/data</h1>
          <p>One adapter contract for arrays, REST, OData and WCF services, with DataSource and ChangeTracker on top. Every tab works against a real service.</p>
        </header>
        <nav class="demo-tabs" role="tablist" aria-label="Examples">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" role="tab" class="demo-tab" aria-selected={() => ui.tab === tab.id} onclick={() => (ui.tab = tab.id)}>
              <span>{tab.title}</span>
              <small>{tab.note}</small>
            </button>
          ))}
        </nav>
        <MemorySection x-wait={() => ui.tab !== 'memory'} />
        <ODataSection x-wait={() => ui.tab !== 'odata'} />
        <LookupSection x-wait={() => ui.tab !== 'lookup'} />
        <VirtualSection x-wait={() => ui.tab !== 'virtual'} />
        <RestSection x-wait={() => ui.tab !== 'rest'} />
        <EditingSection x-wait={() => ui.tab !== 'editing'} />
        <WcfSection x-wait={() => ui.tab !== 'wcf'} />
      </>
    );
  }
}

const app = Application.CreateBuilder().build();
app.useLogging(true);
app.run('#app', <Demo />);
