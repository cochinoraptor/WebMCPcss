/**
 * Logger con colores (chalk) y nivel controlado por `--verbose`.
 */
import chalk from 'chalk';

/**
 * Logger simple: `info`/`warn`/`error` siempre salen; `debug` solo con
 * `verbose` activado.
 */
export class Logger {
  private readonly verbose: boolean;

  /**
   * @param verbose Activa mensajes de depuración (`--verbose`).
   */
  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * Mensaje informativo.
   *
   * @param msg Texto a mostrar.
   */
  info(msg: string): void {
    console.log(msg);
  }

  /**
   * Aviso (amarillo).
   *
   * @param msg Texto a mostrar.
   */
  warn(msg: string): void {
    console.warn(chalk.yellow(msg));
  }

  /**
   * Error (rojo).
   *
   * @param msg Texto a mostrar.
   */
  error(msg: string): void {
    console.error(chalk.red(msg));
  }

  /**
   * Mensaje de depuración (cian); requiere `verbose`.
   *
   * @param msg Texto a mostrar.
   */
  debug(msg: string): void {
    if (this.verbose) console.log(chalk.cyan(msg));
  }
}
