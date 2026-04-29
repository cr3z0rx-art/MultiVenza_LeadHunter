'use strict';

/**
 * Base Driver Interface
 * 
 * Clase base para todos los drivers de scraping de permisos.
 * Cada driver debe implementar los métodos definidos aquí.
 */
class BaseDriver {
    /**
     * Constructor
     * @param {object} config - Configuración del driver
     */
    constructor(config) {
        if (new.target === BaseDriver) {
            throw new Error('BaseDriver es una clase abstracta y no puede ser instanciada directamente');
        }

        this.config = config;
        this.name = 'base';
    }

    /**
     * Inicializa el driver
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error('El método initialize() debe ser implementado por la subclase');
    }

    /**
     * Extrae permisos
     * @param {object} options - Opciones de extracción
     * @param {number} options.days - Número de días hacia atrás para extraer
     * @param {number} options.maxItems - Número máximo de items a extraer
     * @returns {Promise<Array<object>>} - Array de permisos extraídos
     */
    async extractPermits(options) {
        throw new Error('El método extractPermits() debe ser implementado por la subclase');
    }

    /**
     * Extrae historial de contratista
     * @param {string} contractorId - ID del contratista
     * @returns {Promise<Array<object>>} - Historial del contratista
     */
    async extractContractorHistory(contractorId) {
        throw new Error('El método extractContractorHistory() debe ser implementado por la subclase');
    }

    /**
     * Cierra el driver y libera recursos
     * @returns {Promise<void>}
     */
    async close() {
        throw new Error('El método close() debe ser implementado por la subclase');
    }
}

module.exports = BaseDriver;