'use strict';

/**
 * Accela ACA Driver
 * 
 * Driver para extraer permisos de Accela ACA (Fulton County)
 * URL: https://aca-prod.accela.com/ATLANTA_GA/Default.aspx
 */

const axios = require('axios');
const cheerio = require('cheerio');
const BaseDriver = require('./base_driver');

class AccelaDriver extends BaseDriver {
    constructor(config) {
        super(config);
        this.name = 'accela';
        this.baseUrl = config.url || 'https://aca-prod.accela.com/ATLANTA_GA/Default.aspx';
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        });

        this.cookies = '';
        this.viewState = '';
        this.eventValidation = '';
    }

    async initialize() {
        try {
            console.log(`[AccelaDriver] Inicializando conexión a ${this.baseUrl}`);

            // Obtener página inicial para cookies y tokens
            const response = await this.client.get('/');

            // Guardar cookies
            const setCookies = response.headers['set-cookie'];
            if (setCookies) {
                this.cookies = setCookies.join('; ');
                this.client.defaults.headers.Cookie = this.cookies;
            }

            // Extraer viewstate y eventvalidation
            const $ = cheerio.load(response.data);
            this.viewState = $('#__VIEWSTATE').val();
            this.eventValidation = $('#__EVENTVALIDATION').val();

            console.log('[AccelaDriver] Conexión inicializada correctamente');
            return true;
        } catch (error) {
            console.error(`[AccelaDriver] Error al inicializar: ${error.message}`);
            if (error.response) {
                console.error(`Status: ${error.response.status}`);
            }
            return false;
        }
    }

    async extractPermits({ days = 30, maxItems = 100 }) {
        try {
            console.log(`[AccelaDriver] Extrayendo permisos de los últimos ${days} días (max: ${maxItems})`);

            // Si no se ha inicializado, hacerlo ahora
            if (!this.cookies) {
                await this.initialize();
            }

            // Navegar a la página de búsqueda de permisos
            const searchPageResponse = await this.client.get('/Cap/CapHome.aspx?module=Building');

            // Extraer nuevos tokens
            const $search = cheerio.load(searchPageResponse.data);
            this.viewState = $search('#__VIEWSTATE').val();
            this.eventValidation = $search('#__EVENTVALIDATION').val();

            // Calcular fecha desde
            const today = new Date();
            const fromDate = new Date();
            fromDate.setDate(today.getDate() - days);

            // Formato MM/DD/YYYY para Accela
            const fromDateStr = `${fromDate.getMonth() + 1}/${fromDate.getDate()}/${fromDate.getFullYear()}`;
            const toDateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;

            // Preparar payload para búsqueda
            const searchPayload = new URLSearchParams();
            searchPayload.append('__VIEWSTATE', this.viewState);
            searchPayload.append('__EVENTVALIDATION', this.eventValidation);
            searchPayload.append('ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType', 'Building/Residential/Addition/NA');
            searchPayload.append('ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate', fromDateStr);
            searchPayload.append('ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate', toDateStr);
            searchPayload.append('ctl00$PlaceHolderMain$generalSearchForm$btnNewSearch', 'Search');

            // Ejecutar búsqueda
            const searchResultResponse = await this.client.post('/Cap/CapHome.aspx?module=Building', searchPayload, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `${this.baseUrl}/Cap/CapHome.aspx?module=Building`
                }
            });

            // Parsear resultados
            const $results = cheerio.load(searchResultResponse.data);
            const permits = [];

            // Extraer tabla de resultados
            $results('table#ctl00_PlaceHolderMain_dgvPermitList tr').each((i, row) => {
                // Saltar encabezado
                if (i === 0) return;

                // Limitar a maxItems
                if (permits.length >= maxItems) return;

                const $row = $results(row);
                const $cells = $row.find('td');

                if ($cells.length >= 6) {
                    const permitNumber = $cells.eq(0).text().trim();
                    const permitType = $cells.eq(1).text().trim();
                    const address = $cells.eq(2).text().trim();
                    const status = $cells.eq(3).text().trim();
                    const dateApplied = $cells.eq(4).text().trim();

                    // Extraer link para detalles
                    const detailsLink = $cells.eq(0).find('a').attr('href');
                    const permitId = detailsLink ? this.extractPermitId(detailsLink) : '';

                    permits.push({
                        permitNumber,
                        permitType,
                        address,
                        status,
                        permitDate: dateApplied,
                        county: 'Fulton',
                        city: 'Atlanta',
                        state: 'GA',
                        permitId,
                        source: 'Accela ACA Fulton',
                        // Estos campos se llenarán con extractPermitDetails
                        valuation: 0,
                        contractorName: 'Pending Verification',
                        contractorId: '',
                        ownerName: 'Pending Verification',
                    });
                }
            });

            // Extraer detalles para cada permiso
            console.log(`[AccelaDriver] Encontrados ${permits.length} permisos. Extrayendo detalles...`);

            const enrichedPermits = [];
            for (const permit of permits) {
                if (permit.permitId) {
                    try {
                        const details = await this.extractPermitDetails(permit.permitId);
                        enrichedPermits.push({
                            ...permit,
                            ...details
                        });
                    } catch (error) {
                        console.error(`[AccelaDriver] Error extrayendo detalles para ${permit.permitNumber}: ${error.message}`);
                        enrichedPermits.push(permit);
                    }

                    // Pausa para no sobrecargar el servidor
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    enrichedPermits.push(permit);
                }
            }

            console.log(`[AccelaDriver] Extracción completada: ${enrichedPermits.length} permisos`);
            if (enrichedPermits.length === 0 && this.config.fallbackToStub) { console.log('[AccelaDriver] 0 resultados. Activando STUB...'); return this.generateStubData(days, maxItems); } return enrichedPermits;
        } catch (error) {
            console.error(`[AccelaDriver] Error extrayendo permisos: ${error.message}`);

            // Si hay error de conexión, intentar con datos simulados
            if (this.config.fallbackToStub) {
                console.log('[AccelaDriver] Usando datos simulados como fallback');
                return this.generateStubData(days, maxItems);
            }

            return [];
        }
    }

    async extractPermitDetails(permitId) {
        try {
            // Obtener página de detalles del permiso
            const detailsUrl = `/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=${permitId}&capID2=&capID3=&agencyCode=ATLANTA_GA`;
            const response = await this.client.get(detailsUrl);

            const $ = cheerio.load(response.data);

            // Extraer valuation
            let valuation = 0;
            $('table.ACA_TabRow_Even, table.ACA_TabRow_Odd').each((i, table) => {
                const $table = $(table);
                const label = $table.find('td.ACA_AlignLeftOrRightTop').text().trim();

                if (label.includes('Valuation')) {
                    const valueText = $table.find('td.ACA_AlignLeftOrRightBottom').text().trim();
                    valuation = this.extractNumber(valueText);
                }
            });

            // Extraer información del contratista
            let contractorName = '';
            let contractorId = '';

            // Buscar en la sección de Licensed Professional
            $('div#divLicensedProfessionalTemplate table tr').each((i, row) => {
                const $cells = $(row).find('td');
                if ($cells.length >= 2) {
                    const header = $cells.eq(0).text().trim();
                    const value = $cells.eq(1).text().trim();

                    if (header.includes('Name')) {
                        contractorName = value;
                    } else if (header.includes('License')) {
                        contractorId = value;
                    }
                }
            });

            // Extraer información del propietario
            let ownerName = '';

            // Buscar en la sección de Owner
            $('div#divOwnerTemplate table tr').each((i, row) => {
                const $cells = $(row).find('td');
                if ($cells.length >= 2) {
                    const header = $cells.eq(0).text().trim();
                    const value = $cells.eq(1).text().trim();

                    if (header.includes('Name')) {
                        ownerName = value;
                    }
                }
            });

            // Si no se encuentra el nombre en la sección principal, buscar en otras secciones
            if (!ownerName || ownerName === '') {
                // Buscar en la sección de Applicant
                $('div#divApplicantTemplate table tr').each((i, row) => {
                    const $cells = $(row).find('td');
                    if ($cells.length >= 2) {
                        const header = $cells.eq(0).text().trim();
                        const value = $cells.eq(1).text().trim();

                        if (header.includes('Name')) {
                            ownerName = value;
                        }
                    }
                });

                // Buscar en la sección de Contact
                if (!ownerName || ownerName === '') {
                    $('div#divContactTemplate table tr').each((i, row) => {
                        const $cells = $(row).find('td');
                        if ($cells.length >= 2) {
                            const header = $cells.eq(0).text().trim();
                            const value = $cells.eq(1).text().trim();

                            if (header.includes('Name')) {
                                ownerName = value;
                            }
                        }
                    });
                }
            }

            // Si aún no se encuentra, marcar como pendiente de verificación
            if (!ownerName || ownerName === '') {
                ownerName = 'Pending Verification';
            }

            const ownerType = this.detectOwnerType(ownerName);
            return {
                valuation,
                contractorName,
                contractorId,
                ownerName,
                ownerType,
            };
        } catch (error) {
            console.error(`[AccelaDriver] Error extrayendo detalles: ${error.message}`);
            return {
                valuation: 0,
                contractorName: '',
                contractorId: '',
                ownerName: '',
                ownerType: 'UNKNOWN',
            };
        }
    }

    async extractContractorHistory(contractorId) {
        if (!contractorId) {
            return [];
        }

        try {
            console.log(`[AccelaDriver] Extrayendo historial del contratista ${contractorId}`);

            // Navegar a la página de búsqueda de licencias
            const searchPageResponse = await this.client.get('/Cap/CapHome.aspx?module=Licenses');

            // Extraer nuevos tokens
            const $search = cheerio.load(searchPageResponse.data);
            this.viewState = $search('#__VIEWSTATE').val();
            this.eventValidation = $search('#__EVENTVALIDATION').val();

            // Preparar payload para búsqueda por licencia
            const searchPayload = new URLSearchParams();
            searchPayload.append('__VIEWSTATE', this.viewState);
            searchPayload.append('__EVENTVALIDATION', this.eventValidation);
            searchPayload.append('ctl00$PlaceHolderMain$generalSearchForm$txtGSLicenseNumber', contractorId);
            searchPayload.append('ctl00$PlaceHolderMain$generalSearchForm$btnNewSearch', 'Search');

            // Ejecutar búsqueda
            const searchResultResponse = await this.client.post('/Cap/CapHome.aspx?module=Licenses', searchPayload, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `${this.baseUrl}/Cap/CapHome.aspx?module=Licenses`
                }
            });

            // Parsear resultados
            const $results = cheerio.load(searchResultResponse.data);
            const history = [];

            // Extraer tabla de resultados
            $results('table#ctl00_PlaceHolderMain_dgvPermitList tr').each((i, row) => {
                // Saltar encabezado
                if (i === 0) return;

                const $row = $results(row);
                const $cells = $row.find('td');

                if ($cells.length >= 5) {
                    const projectNumber = $cells.eq(0).text().trim();
                    const projectType = $cells.eq(1).text().trim();
                    const projectAddress = $cells.eq(2).text().trim();
                    const projectStatus = $cells.eq(3).text().trim();
                    const projectDate = $cells.eq(4).text().trim();

                    history.push({
                        projectNumber,
                        projectType,
                        projectAddress,
                        projectStatus,
                        projectDate,
                        contractorId
                    });
                }
            });

            console.log(`[AccelaDriver] Historial extraído: ${history.length} proyectos`);
            return history;
        } catch (error) {
            console.error(`[AccelaDriver] Error extrayendo historial: ${error.message}`);
            return [];
        }
    }

    async close() {
        // Limpiar recursos
        this.cookies = '';
        this.viewState = '';
        this.eventValidation = '';
        console.log('[AccelaDriver] Conexión cerrada');
    }

    // Helpers

    /**
     * Clasifica el tipo de propietario para enrutar la estrategia de skip tracing.
     * LLC → Outscraper Google Maps | PERSON → Tax Assessor + BatchData
     */
    detectOwnerType(ownerName) {
        if (!ownerName || ownerName === 'Pending Verification') return 'UNKNOWN';
        const LLC_PATTERN = /\b(LLC|INC|CORP|CO|LTD|LP|LLP|PLLC|PC|PA|PROPERTIES|HOLDINGS|INVESTMENTS|ENTERPRISES|GROUP|REALTY|DEVELOPMENT|DEVELOPERS|MANAGEMENT|CONSTRUCTION|BUILDERS?|SERVICES?|SOLUTIONS?|ASSOCIATES?|PARTNERS?|TRUST|FUND)\b/i;
        return LLC_PATTERN.test(ownerName) ? 'LLC' : 'PERSON';
    }

    extractPermitId(url) {
        // Ejemplo: /Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=21CAP&capID2=00000&capID3=001AB&agencyCode=ATLANTA_GA
        const match = url.match(/capID1=([^&]+)&capID2=([^&]+)&capID3=([^&]+)/);
        if (match && match.length >= 4) {
            return match[1];
        }
        return '';
    }

    extractNumber(text) {
        // Extraer número de texto como "$12,345.67" -> 12345.67
        const match = text.match(/[\d,]+\.?\d*/);
        if (match) {
            return parseFloat(match[0].replace(/,/g, ''));
        }
        return 0;
    }

    generateStubData(days, maxItems) {
        console.log('[AccelaDriver] Generando datos simulados para Fulton County');

        const permitTypes = [
            'Building/Residential/Addition/NA',
            'Building/Residential/New Construction/NA',
            'Building/Residential/Remodel/NA',
            'Building/Commercial/New Construction/NA',
            'Building/Commercial/Remodel/NA'
        ];

        const streets = [
            'Peachtree St',
            'Piedmont Ave',
            'Ponce de Leon Ave',
            'North Ave',
            'Marietta St',
            'Spring St',
            'West Peachtree St',
            'Courtland St',
            'Centennial Olympic Park Dr'
        ];

        const statuses = ['Issued', 'In Review', 'Approved', 'Finaled'];
        const contractors = [
            { name: 'Atlanta Construction Co', id: 'ATL-2023-1234' },
            { name: 'Georgia Builders LLC', id: 'GA-2022-5678' },
            { name: 'Peachtree Contractors', id: 'PC-2021-9012' },
            { name: 'Fulton Development Group', id: 'FDG-2023-3456' },
            { name: null, id: null } // Para simular No-GC
        ];

        const permits = [];
        const count = Math.min(maxItems, 50); // Generar hasta 50 permisos simulados

        for (let i = 0; i < count; i++) {
            // Generar fecha aleatoria dentro del rango
            const daysAgo = Math.floor(Math.random() * days);
            const date = new Date();
            date.setDate(date.getDate() - daysAgo);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;

            // Seleccionar valores aleatorios
            const permitType = permitTypes[Math.floor(Math.random() * permitTypes.length)];
            const street = streets[Math.floor(Math.random() * streets.length)];
            const status = statuses[Math.floor(Math.random() * statuses.length)];
            const contractor = contractors[Math.floor(Math.random() * contractors.length)];

            // Generar valuación con distribución que favorece valores altos para Atlanta
            let valuation;
            const rand = Math.random();
            if (rand < 0.3) {
                // 30% de probabilidad de ser un proyecto grande (>$100k)
                valuation = 100000 + Math.random() * 900000;
            } else if (rand < 0.6) {
                // 30% de probabilidad de ser un proyecto mediano ($15k-$100k)
                valuation = 15000 + Math.random() * 85000;
            } else {
                // 40% de probabilidad de ser un proyecto pequeño ($5k-$15k)
                valuation = 5000 + Math.random() * 15000;
            }

            permits.push({
                permitNumber: `FULTON-${2026}${i.toString().padStart(4, '0')}`,
                permitType,
                address: `${Math.floor(Math.random() * 9000) + 1000} ${street}`,
                status,
                permitDate: dateStr,
                county: 'Fulton',
                city: 'Atlanta',
                state: 'GA',
                permitId: `STUB-${i}`,
                source: 'Accela ACA Fulton (STUB)',
                valuation: Math.round(valuation * 100) / 100,
                contractorName: contractor.name || 'Pending Verification',
                contractorId: contractor.id,
                ownerName: 'Pending Verification',
                ownerType: 'UNKNOWN',
            });
        }

        return permits;
    }
}

module.exports = AccelaDriver;