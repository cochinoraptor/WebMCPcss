/**
 * Historial de cambios genérico con deshacer/rehacer.
 *
 * Cada entrada guarda dos closures (`undo`/`redo`) y una etiqueta legible.
 * Al añadir una entrada nueva, la pila de "rehacer" se vacía (comportamiento
 * estándar de los editores).
 */

/** Entrada del historial. */
export interface HistoryEntry {
  /** Descripción legible del cambio (`add p-8 → .card-1`). */
  label: string;
  /** Revierte el cambio. */
  undo: () => void;
  /** Vuelve a aplicar el cambio. */
  redo: () => void;
}

/** Historial con pilas de deshacer/rehacer. */
export class ChangeHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  /**
   * Registra un cambio ya aplicado.
   * @param entry Entrada con sus closures de undo/redo.
   */
  push(entry: HistoryEntry): void {
    this.past.push(entry);
    this.future = [];
  }

  /** ¿Hay cambios que deshacer? */
  canUndo(): boolean {
    return this.past.length > 0;
  }

  /** ¿Hay cambios que rehacer? */
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Deshace el último cambio.
   * @returns La etiqueta del cambio deshecho, o `null` si no había.
   */
  undo(): string | null {
    const entry = this.past.pop();
    if (!entry) return null;
    entry.undo();
    this.future.push(entry);
    return entry.label;
  }

  /**
   * Rehace el último cambio deshecho.
   * @returns La etiqueta del cambio rehecho, o `null` si no había.
   */
  redo(): string | null {
    const entry = this.future.pop();
    if (!entry) return null;
    entry.redo();
    this.past.push(entry);
    return entry.label;
  }

  /** Etiquetas de los cambios aplicados (en orden cronológico). */
  list(): string[] {
    return this.past.map((e) => e.label);
  }

  /** Vacía el historial por completo. */
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
