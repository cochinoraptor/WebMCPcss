/**
 * IA-First Web Framework: asistente (`webmcpcss assist "<petición>"`).
 *
 * Convierte una petición en lenguaje natural («crea un formulario de
 * contacto») en componentes IA-First → HTML + `.webmcp.css`. Con un LLM
 * configurado (`WEBMCP_LLM_PROVIDER`…) el modelo elige componentes y campos;
 * sin LLM se usan heurísticas locales por vocabulario (siempre funciona).
 */
import { extractJsonObject } from '../prompt/llm-client';
import type { LlmClient } from '../prompt/types';
import {
  IA_COMPONENTS,
  renderComponent,
  toToolName,
  type IaComponentName,
  type IaComponentOptions,
  type IaField,
  type RenderedComponent,
} from './components';

/** Plan de componentes (salida del LLM o de las heurísticas). */
export interface AssistPlan {
  components: Array<{ component: IaComponentName; options: IaComponentOptions }>;
  /** `llm` o `heuristic`. */
  source: 'llm' | 'heuristic';
  /** Explicación corta. */
  rationale: string;
}

/** Resultado del asistente. */
export interface AssistResult {
  plan: AssistPlan;
  rendered: RenderedComponent[];
  /** HTML combinado. */
  html: string;
  /** `.webmcp.css` combinado. */
  css: string;
}

/** Vocabulario de campos por palabra clave (heurísticas locales). */
const FIELD_VOCAB: Array<{ re: RegExp; field: IaField }> = [
  { re: /nombre|name/i, field: { name: 'name', label: 'Nombre', required: true } },
  { re: /email|correo/i, field: { name: 'email', label: 'Email', type: 'email', required: true } },
  { re: /tel[eé]fono|phone|m[oó]vil/i, field: { name: 'phone', label: 'Teléfono', type: 'tel' } },
  { re: /mensaje|message|comentario/i, field: { name: 'message', label: 'Mensaje', type: 'textarea', required: true } },
  { re: /contrase[ñn]a|password/i, field: { name: 'password', label: 'Contraseña', type: 'password', required: true } },
  { re: /usuario|username/i, field: { name: 'username', label: 'Usuario', required: true } },
  { re: /asunto|subject/i, field: { name: 'subject', label: 'Asunto' } },
  { re: /empresa|company/i, field: { name: 'company', label: 'Empresa' } },
  { re: /direcci[oó]n|address/i, field: { name: 'address', label: 'Dirección' } },
  { re: /cantidad|quantity|qty/i, field: { name: 'quantity', label: 'Cantidad', type: 'number' } },
  { re: /fecha|date/i, field: { name: 'date', label: 'Fecha' } },
  { re: /b[uú]squeda|buscar|search|query/i, field: { name: 'query', label: 'Buscar', placeholder: 'Buscar…', required: true } },
];

/**
 * Heurísticas locales: deduce componentes de la petición sin LLM.
 * @param request Petición en lenguaje natural.
 */
export function planHeuristically(request: string): AssistPlan {
  const text = request.toLowerCase();
  const components: AssistPlan['components'] = [];
  const fieldsFromText = (): IaField[] => {
    const fields: IaField[] = [];
    for (const { re, field } of FIELD_VOCAB) if (re.test(text) && !fields.some((f) => f.name === field.name)) fields.push(field);
    return fields;
  };

  if (/formulario|form\b|registro|login|inicio de sesi[oó]n|contacto|suscri|newsletter/.test(text)) {
    let tool = 'submitForm';
    let label = 'Enviar';
    let fields = fieldsFromText();
    if (/contacto|contact/.test(text)) {
      tool = 'sendContact';
      label = 'Enviar mensaje';
      if (fields.length === 0) fields = [FIELD_VOCAB[0].field, FIELD_VOCAB[1].field, FIELD_VOCAB[3].field];
    } else if (/login|inicio de sesi[oó]n|acceder/.test(text)) {
      tool = 'login';
      label = 'Iniciar sesión';
      if (fields.length === 0) fields = [FIELD_VOCAB[1].field, FIELD_VOCAB[4].field];
    } else if (/registro|regist|crear cuenta|sign ?up/.test(text)) {
      tool = 'register';
      label = 'Crear cuenta';
      if (fields.length === 0) fields = [FIELD_VOCAB[0].field, FIELD_VOCAB[1].field, FIELD_VOCAB[4].field];
    } else if (/suscri|newsletter|bolet[ií]n/.test(text)) {
      tool = 'subscribe';
      label = 'Suscribirme';
      if (fields.length === 0) fields = [FIELD_VOCAB[1].field];
    } else if (fields.length === 0) {
      fields = [FIELD_VOCAB[0].field, FIELD_VOCAB[1].field];
    }
    components.push({
      component: 'form',
      options: { tool, label, description: request.trim(), confirmation: 'needed', fields },
    });
  }
  if (/buscador|b[uú]squeda|search/.test(text) && !components.some((c) => c.options.tool === 'search')) {
    components.push({
      component: 'form',
      options: {
        tool: 'search',
        label: 'Buscar',
        description: 'Busca en el sitio',
        confirmation: 'none',
        fields: [FIELD_VOCAB[11].field],
      },
    });
  }
  if (/hero|portada|cabecera|landing/.test(text)) {
    components.push({
      component: 'hero',
      options: {
        tool: 'hero',
        label: 'Bienvenido',
        body: request.trim(),
        items: [{ label: 'Empezar', href: '#main', tool: 'getStarted' }],
      },
    });
  }
  if (/men[uú]|navegaci[oó]n|nav\b|navbar/.test(text)) {
    components.push({
      component: 'nav',
      options: {
        tool: 'mainNav',
        label: 'Navegación principal',
        items: [
          { label: 'Inicio', href: '/', tool: 'goHome' },
          { label: 'Productos', href: '/productos', tool: 'goProducts' },
          { label: 'Contacto', href: '/contacto', tool: 'goContact' },
        ],
      },
    });
  }
  if (/cat[aá]logo|listado|lista de|productos|art[ií]culos|grid|galer[ií]a/.test(text)) {
    components.push({
      component: 'grid',
      options: {
        tool: 'catalog',
        label: 'Catálogo',
        items: [
          { label: 'Elemento 1', tool: 'addToCart' },
          { label: 'Elemento 2', tool: 'addToCart' },
        ],
      },
    });
  }
  if (/tarjeta|card|oferta|promo/.test(text)) {
    components.push({
      component: 'card',
      options: {
        tool: 'offer',
        label: 'Oferta',
        body: request.trim(),
        items: [{ label: 'Aplicar', tool: 'applyOffer' }],
      },
    });
  }
  if (/bot[oó]n|button|cta|comprar|pagar|checkout|eliminar|borrar|cancelar/.test(text) && components.length === 0) {
    const destructive = /eliminar|borrar|cancelar|pagar|comprar|checkout/.test(text);
    components.push({
      component: 'button',
      options: {
        tool: toToolName(request, 'doAction'),
        label: request.trim().slice(0, 40),
        description: request.trim(),
        intent: /cancelar/.test(text) ? 'cancel' : /comprar|pagar|checkout/.test(text) ? 'submit' : 'action',
        confirmation: destructive ? 'needed' : 'none',
      },
    });
  }
  if (components.length === 0) {
    components.push({
      component: 'button',
      options: { tool: toToolName(request, 'doAction'), label: request.trim().slice(0, 40), description: request.trim(), intent: 'action', confirmation: 'none' },
    });
  }
  return { components, source: 'heuristic', rationale: 'Componentes deducidos por vocabulario (sin LLM).' };
}

const SYSTEM_PROMPT = `Eres el asistente del framework IA-First de WebMCPcss. Convierte la petición del usuario en un plan JSON de componentes web declarativos.
Componentes disponibles: ${IA_COMPONENTS.join(', ')}.
Responde SOLO con JSON: {"rationale": string, "components": [{"component": string, "options": {"tool": camelCase, "label": string, "description": string, "intent": "submit|cancel|navigate|action|read", "confirmation": "needed|none", "fields": [{"name","label","type","required"}], "items": [{"label","href","tool"}], "body": string}}]}.
Reglas: nombres de herramienta en camelCase en inglés; los formularios llevan "fields"; nav/grid/hero llevan "items"; acciones destructivas o de pago usan confirmation "needed".`;

/**
 * Pide el plan al LLM y lo valida; si falla, devuelve `null`.
 * @param client Cliente LLM.
 * @param request Petición.
 */
export async function planWithLlm(client: LlmClient, request: string): Promise<AssistPlan | null> {
  try {
    const raw = await client.complete({ system: SYSTEM_PROMPT, user: request, json: true, temperature: 0.2 });
    const obj = extractJsonObject(raw);
    if (!obj || !Array.isArray(obj.components)) return null;
    const components: AssistPlan['components'] = [];
    for (const c of obj.components as Array<Record<string, unknown>>) {
      const component = String(c.component ?? '') as IaComponentName;
      if (!(IA_COMPONENTS as readonly string[]).includes(component)) continue;
      const options = (c.options ?? {}) as IaComponentOptions;
      if (!options.tool) options.tool = toToolName(String(options.label ?? component), component);
      options.tool = toToolName(options.tool, component);
      components.push({ component, options });
    }
    if (components.length === 0) return null;
    return { components, source: 'llm', rationale: String(obj.rationale ?? 'Plan generado por LLM') };
  } catch {
    return null;
  }
}

/**
 * Ejecuta el asistente: plan (LLM o heurístico) → componentes renderizados.
 * @param request Petición en lenguaje natural.
 * @param client Cliente LLM opcional (`createLlmClient()`); `null` = heurísticas.
 */
export async function assist(request: string, client: LlmClient | null = null): Promise<AssistResult> {
  const plan = (client && (await planWithLlm(client, request))) || planHeuristically(request);
  const rendered = plan.components.map((c) => renderComponent(c.component, c.options));
  return {
    plan,
    rendered,
    html: rendered.map((r) => r.html).join('\n\n') + '\n',
    css: `/* Generado por webmcpcss assist: "${request.replace(/\*\//g, '')}" */\n\n` + rendered.map((r) => r.css.trimEnd()).join('\n\n') + '\n',
  };
}
