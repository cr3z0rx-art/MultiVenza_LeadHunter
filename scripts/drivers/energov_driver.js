'use strict';

/**
 * EnerGov Driver
 * 
 * Driver para extraer permisos de Tyler EnerGov (Gwinnett County)
 * URL: https://gwinnettcounty-energovpub.tylerhost.net/apps/selfservice#/search
 */

const axios = require('axios');
const BaseDriver = require('./base_driver');

class EnerGovDriver extends BaseDriver {
    constructor(config) {
        super(config);
        this.name = 'energov';
        this.baseUrl = config.url || 'https://gwinnettcounty-energovpub.tylerhost.net';
        this.apiUrl = `${this.baseUrl}/api`;
        this.client = axios.create({
            baseURL: this.apiUrl,
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            }
        });

        this.token = '';
        this.initialized = false;
    }

    async initialize() {
        try {
            console.log(`[EnerGovDriver] Inicializando conexión a ${this.baseUrl}`);

            // EnerGov usa una API REST, primero necesitamos obtener un token
            const tokenResponse = await this.client.post('/auth/token', {
                // Normalmente aquí irían credenciales, pero EnerGov permite búsqueda pública sin autenticación
                // Usamos un token vacío para búsquedas públicas
            });

            if (tokenResponse.data && tokenResponse.data.access_token) {
                this.token = tokenResponse.data.access_token;
                this.client.defaults.headers.Authorization = `Bearer ${this.token}`;
            }

            this.initialized = true;
            console.log('[EnerGovDriver] Conexión inicializada correctamente');
            return true;
        } catch (error) {
            console.error(`[EnerGovDriver] Error al inicializar: ${error.message}`);
            if (error.response) {
                console.error(`Status: ${error.response.status}`);
            }
            return false;
        }
    }

    async extractPermits({ days = 30, maxItems = 100 }) {
        try {
            console.log(`[EnerGovDriver] Extrayendo permisos de los últimos ${days} días (max: ${maxItems})`);

            // Si no se ha inicializado, hacerlo ahora
            if (!this.initialized) {
                const success = await this.initialize();
                if (!success) {
                    throw new Error('No se pudo inicializar el driver');
                }
            }

            // Calcular fecha desde
            const today = new Date();
            const fromDate = new Date();
            fromDate.setDate(today.getDate() - days);

            // Formato ISO para EnerGov API
            const fromDateStr = fromDate.toISOString();
            const toDateStr = today.toISOString();

            // Preparar payload para búsqueda
            // EnerGov API usa GraphQL o REST dependiendo de la implementación
            // Aquí usamos el endpoint REST para permisos
            const searchPayload = {
                searchModule: 'permits',
                pageNumber: 1,
                pageSize: maxItems,
                sortBy: 'appliedDate',
                sortDirection: 'desc',
                filters: [
                    {
                        field: 'appliedDate',
                        operator: 'between',
                        values: [fromDateStr, toDateStr]
                    },
                    {
                        field: 'permitType',
                        operator: 'in',
                        values: ['Building', 'Residential', 'Commercial']
                    }
                ]
            };

            // Ejecutar búsqueda
            const searchResponse = await this.client.post('/search/permits', searchPayload);

            if (!searchResponse.data || !searchResponse.data.results) {
                throw new Error('Formato de respuesta inesperado');
            }

            const rawPermits = searchResponse.data.results;
            console.log(`[EnerGovDriver] Encontrados ${rawPermits.length} permisos`);

            // Transformar a formato estándar
            const permits = [];

            for (const raw of rawPermits) {
                // Limitar a maxItems
                if (permits.length >= maxItems) break;

                permits.push({
                    permitNumber: raw.permitNumber || '',
                    permitType: raw.permitType || '',
                    address: raw.address || '',
                    status: raw.status || '',
                    permitDate: raw.appliedDate ? new Date(raw.appliedDate).toISOString().slice(0, 10) : '',
                    county: 'Gwinnett',
                    city: raw.city || 'Lawrenceville', // Ciudad por defecto en Gwinnett
                    state: 'GA',
                    permitId: raw.id || '',
                    source: 'Tyler EnerGov Gwinnett',
                    valuation: parseFloat(raw.valuation || 0),
                    contractorName: raw.contractorName || 'Pending Verification',
                    contractorId: raw.contractorLicense || '',
                    ownerName: raw.ownerName || 'Pending Verification',
                });
            }

            // Si tenemos IDs de permisos pero faltan detalles, extraerlos
            const needsDetails = permits.filter(p => p.permitId && (!p.valuation || !p.contractorName));

            if (needsDetails.length > 0) {
                console.log(`[EnerGovDriver] Extrayendo detalles para ${needsDetails.length} permisos...`);

                for (const permit of needsDetails) {
                    try {
                        const details = await this.extractPermitDetails(permit.permitId);

                        // Actualizar el permiso con los detalles
                        const index = permits.findIndex(p => p.permitId === permit.permitId);
                        if (index !== -1) {
                            permits[index] = {
                                ...permits[index],
                                ...details
                            };
                        }

                        // Pausa para no sobrecargar el servidor
                        await new Promise(r => setTimeout(r, 300));
                    } catch (error) {
                        console.error(`[EnerGovDriver] Error extrayendo detalles para ${permit.permitNumber}: ${error.message}`);
                    }
                }
            }

            console.log(`[EnerGovDriver] Extracción completada: ${permits.length} permisos`);
            if (permits.length === 0 && this.config.fallbackToStub) { console.log('[EnerGovDriver] 0 resultados. Activando STUB...'); return this.generateStubData(days, maxItems); } return permits;
        } catch (error) {
            console.error(`[EnerGovDriver] Error extrayendo permisos: ${error.message}`);

            // Si hay error de conexión, intentar con datos simulados
            if (this.config.fallbackToStub) {
                console.log('[EnerGovDriver] Usando datos simulados como fallback');
                return this.generateStubData(days, maxItems);
            }

            return [];
        }
    }

    async extractPermitDetails(permitId) {
        try {
            // Obtener detalles del permiso
            const response = await this.client.get(`/permits/${permitId}`);

            if (!response.data) {
                throw new Error('Formato de respuesta inesperado');
            }

            const data = response.data;

            // Extraer información relevante
            let ownerName = data.owner?.name || '';

            // Si no hay nombre de propietario, intentar obtenerlo de otras fuentes
            if (!ownerName || ownerName === '') {
                // Intentar obtener de applicant
                ownerName = data.applicant?.name || '';

                // Si aún no hay nombre, intentar obtener de contact
                if (!ownerName || ownerName === '') {
                    ownerName = data.contact?.name || '';
                }

                // Si aún no hay nombre, intentar hacer una solicitud adicional para obtener detalles
                if (!ownerName || ownerName === '') {
                    try {
                        // Intentar obtener detalles adicionales del permiso
                        const detailsResponse = await this.client.get(`/permits/${permitId}/details`);
                        if (detailsResponse.data && detailsResponse.data.owner) {
                            ownerName = detailsResponse.data.owner.name || '';
                        }
                    } catch (error) {
                        console.error(`[EnerGovDriver] Error obteniendo detalles adicionales: ${error.message}`);
                    }
                }
            }

            // Si aún no hay nombre, marcar como pendiente de verificación
            if (!ownerName || ownerName === '') {
                ownerName = 'Pending Verification';
            }

            return {
                valuation: parseFloat(data.valuation || 0),
                contractorName: data.contractor?.name || '',
                contractorId: data.contractor?.licenseNumber || '',
                ownerName: ownerName,
                description: data.description || '',
                workType: data.workType || '',
                squareFeet: data.squareFeet || 0,
            };
        } catch (error) {
            console.error(`[EnerGovDriver] Error extrayendo detalles: ${error.message}`);
            return {
                valuation: 0,
                contractorName: '',
                contractorId: '',
                ownerName: ''
            };
        }
    }

    async extractContractorHistory(contractorId) {
        if (!contractorId) {
            return [];
        }

        try {
            console.log(`[EnerGovDriver] Extrayendo historial del contratista ${contractorId}`);

            // Buscar permisos por ID de contratista
            const searchPayload = {
                searchModule: 'permits',
                pageNumber: 1,
                pageSize: 50, // Limitar a 50 proyectos históricos
                sortBy: 'appliedDate',
                sortDirection: 'desc',
                filters: [
                    {
                        field: 'contractorLicense',
                        operator: 'eq',
                        values: [contractorId]
                    }
                ]
            };

            const searchResponse = await this.client.post('/search/permits', searchPayload);

            if (!searchResponse.data || !searchResponse.data.results) {
                throw new Error('Formato de respuesta inesperado');
            }

            const rawProjects = searchResponse.data.results;

            // Transformar a formato estándar
            const history = rawProjects.map(raw => ({
                projectNumber: raw.permitNumber || '',
                projectType: raw.permitType || '',
                projectAddress: raw.address || '',
                projectStatus: raw.status || '',
                projectDate: raw.appliedDate ? new Date(raw.appliedDate).toISOString().slice(0, 10) : '',
                contractorId,
                valuation: parseFloat(raw.valuation || 0)
            }));

            console.log(`[EnerGovDriver] Historial extraído: ${history.length} proyectos`);
            return history;
        } catch (error) {
            console.error(`[EnerGovDriver] Error extrayendo historial: ${error.message}`);
            return [];
        }
    }

    async close() {
        // Limpiar recursos
        this.token = '';
        this.initialized = false;
        console.log('[EnerGovDriver] Conexión cerrada');
    }

    generateStubData(days, maxItems) {
        console.log('[EnerGovDriver] Generando datos simulados para Gwinnett County');

        const permitTypes = [
            'Building/Residential/Addition',
            'Building/Residential/New Construction',
            'Building/Residential/Remodel',
            'Building/Commercial/New Construction',
            'Building/Commercial/Remodel',
            'Building/Residential/Basement Finish'
        ];

        const cities = ['Lawrenceville', 'Duluth', 'Suwanee', 'Norcross', 'Lilburn', 'Snellville'];

        const streets = [
            'Sugarloaf Pkwy',
            'Pleasant Hill Rd',
            'Satellite Blvd',
            'Buford Hwy',
            'Peachtree Industrial Blvd',
            'Jimmy Carter Blvd',
            'Lawrenceville Hwy',
            'Old Peachtree Rd'
        ];

        const statuses = ['Issued', 'In Review', 'Approved', 'Finaled', 'Expired'];
        const contractors = [
            { name: 'Gwinnett Builders Inc', id: 'GWN-2023-1234' },
            { name: 'Duluth Construction LLC', id: 'DUL-2022-5678' },
            { name: 'Sugarloaf Contractors', id: 'SL-2021-9012' },
            { name: 'Lawrenceville Development', id: 'LVD-2023-3456' },
            { name: null, id: null } // Para simular No-GC
        ];

        const permits = [];
        const count = Math.min(maxItems, 50); // Generar hasta 50 permisos simulados

        for (let i = 0; i < count; i++) {
            // Generar fecha aleatoria dentro del rango
            const daysAgo = Math.floor(Math.random() * days);
            const date = new Date();
            date.setDate(date.getDate() - daysAgo);
            const dateStr = date.toISOString().slice(0, 10);

            // Seleccionar valores aleatorios
            const permitType = permitTypes[Math.floor(Math.random() * permitTypes.length)];
            const city = cities[Math.floor(Math.random() * cities.length)];
            const street = streets[Math.floor(Math.random() * streets.length)];
            const status = statuses[Math.floor(Math.random() * statuses.length)];
            const contractor = contractors[Math.floor(Math.random() * contractors.length)];

            // Generar valuación con distribución que favorece valores altos para Gwinnett
            let valuation;
            const rand = Math.random();
            if (rand < 0.2) {
                // 20% de probabilidad de ser un proyecto grande (>$100k)
                valuation = 100000 + Math.random() * 500000;
            } else if (rand < 0.5) {
                // 30% de probabilidad de ser un proyecto mediano ($15k-$100k)
                valuation = 15000 + Math.random() * 85000;
            } else {
                // 50% de probabilidad de ser un proyecto pequeño ($5k-$15k)
                valuation = 5000 + Math.random() * 15000;
            }

            permits.push({
                permitNumber: `GWIN-${2026}${i.toString().padStart(4, '0')}`,
                permitType,
                address: `${Math.floor(Math.random() * 9000) + 1000} ${street}`,
                status,
                permitDate: dateStr,
                county: 'Gwinnett',
                city,
                state: 'GA',
                permitId: `STUB-GWIN-${i}`,
                source: 'Tyler EnerGov Gwinnett (STUB)',
                valuation: Math.round(valuation * 100) / 100,
                contractorName: contractor.name || 'Pending Verification',
                contractorId: contractor.id,
                ownerName: 'Pending Verification',
            });
        }

        return permits;
    }
}

module.exports = EnerGovDriver;