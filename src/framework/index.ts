/** IA-First Web Framework (v1.0.0). */
export {
  COMPONENT_CATALOG,
  IA_COMPONENTS,
  IA_CONFIRMATIONS,
  IA_FIRST_BASE_CSS,
  IA_INTENTS,
  escapeHtml,
  parseAccessibility,
  renderComponent,
  toKebab,
  toToolName,
  validateIaFirst,
  type IaComponentName,
  type IaComponentOptions,
  type IaComponentSpec,
  type IaConfirmation,
  type IaField,
  type IaIntent,
  type IaValidationIssue,
  type RenderedComponent,
} from './components';
export {
  buildIndexHtml,
  defaultTemplateComponents,
  initProject,
  type InitOptions,
  type InitResult,
} from './generator';
export {
  assist,
  planHeuristically,
  planWithLlm,
  type AssistPlan,
  type AssistResult,
} from './assistant';
