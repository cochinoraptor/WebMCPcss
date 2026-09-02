/**
 * Logger con colores para la terminal, basado en chalk.
 * Uso: `logger.info('mensaje')`, `logger.success('...')`, etc.
 */
import chalk from 'chalk';

/** Niveles soportados por el logger. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let verbose = false;

/**
 * Activa o desactiva la salida de nivel `debug`.
 * @param value `true` para mostrar mensajes de depuración.
 */
export function setVerbose(value: boolean): void {
  verbose = value;
}

/** Logger de WebMCPcss con prefijos y colores consistentes. */
export const logger = {
  /**
   * Mensaje de depuración (solo visible con `setVerbose(true)` o `--verbose`).
   * @param msg Mensaje a mostrar.
   */
  debug(msg: string): void {
    if (verbose) console.log(chalk.gray(`[debug] ${msg}`));
  },

  /**
   * Mensaje informativo.
   * @param msg Mensaje a mostrar.
   */
  info(msg: string): void {
    console.log(chalk.cyan('ℹ'), msg);
  },

  /**
   * Mensaje de éxito.
   * @param msg Mensaje a mostrar.
   */
  success(msg: string): void {
    console.log(chalk.green('✔'), msg);
  },

  /**
   * Advertencia.
   * @param msg Mensaje a mostrar.
   */
  warn(msg: string): void {
    console.warn(chalk.yellow('⚠'), msg);
  },

  /**
   * Error.
   * @param msg Mensaje a mostrar.
   */
  error(msg: string): void {
    console.error(chalk.red('✖'), msg);
  },

  /**
   * Título de sección resaltado.
   * @param msg Texto del título.
   */
  title(msg: string): void {
    console.log('\n' + chalk.bold.magenta(msg));
  },
};
