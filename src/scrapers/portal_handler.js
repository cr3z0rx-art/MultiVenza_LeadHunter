'use strict';

/**
 * src/scrapers/portal_handler.js
 * 
 * Centraliza las funciones inyectadas (pageFunctions) de Puppeteer para leer 
 * los portales gubernamentales que no tienen API abierta (ArcGIS).
 * 
 * Orange County -> Fast Track (ASP.NET WebForms)
 * Palm Beach    -> ePZB (AngularJS SPA)
 */

module.exports = {
  
  /**
   * Orange County Fast Track (ASP.NET)
   * URL: https://fasttrack.ocfl.net/OnlineServices/PermitsAllTypes.aspx
   */
  getOrangeCountyDriver(maxItems) {
    return `
      async function pageFunction(context) {
        const { page, request, log } = context;

        try {
          await new Promise(r => setTimeout(r, 3000));

          // 1. Llenar fecha de inicio en el formulario ASPX
          // Selectores reales basados en el estándar de Fast Track OCFL
          const dateInput = await page.$('input[id*="txtStartDate" i], input[id*="txtDateFrom" i]');
          if (dateInput) {
            const today = new Date();
            today.setDate(today.getDate() - 3);
            const dateStr = today.toLocaleDateString('en-US'); // MM/DD/YYYY
            
            // Limpiar y tipear
            await dateInput.click({ clickCount: 3 });
            await dateInput.type(dateStr);
            
            // Click en buscar
            const searchBtn = await page.$('input[value*="Search" i], a[id*="btnSearch" i]');
            if (searchBtn) {
              await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
                searchBtn.click()
              ]);
            }
          }

          // 2. Extraer del DataGrid de ASP.NET
          const rows = await page.evaluate((maxItems) => {
            const data = [];
            // Los DataGrids de ASP.NET en Fast Track usan clases como GridView, o id gvSearchResults
            const rowElements = Array.from(document.querySelectorAll('table[id*="gvSearch" i] tr:not(:first-child), table.DataGrid tr:not(.header)'));

            rowElements.slice(0, maxItems).forEach(row => {
              const cells = Array.from(row.querySelectorAll('td'));
              if (cells.length < 5) return;
              const getText = (idx) => cells[idx] ? cells[idx].textContent.trim() : null;

              data.push({
                permitNumber:   getText(0),
                permitType:     getText(1),
                permitDate:     getText(2),
                status:         getText(3),
                address:        getText(4),
                ownerName:      getText(5) || null,
                contractorName: getText(6) || null,
                valuation:      parseFloat((getText(7) || '').replace(/[^0-9.]/g,'')) || null,
              });
            });
            return data;
          }, ${maxItems});

          log.info('Orange County Fast Track scraped: ' + rows.length + ' rows');
          return [{ permits: rows, county: 'Orange County', source: request.url }];
        } catch(e) {
          log.error('Orange County error: ' + e.message);
          return [{ permits: [], county: 'Orange County', error: e.message }];
        }
      }
    `;
  },

  /**
   * Palm Beach County ePZB (Angular SPA)
   * URL: https://www.pbcgov.com/epzb
   */
  getPalmBeachDriver(maxItems) {
    return `
      async function pageFunction(context) {
        const { page, request, log } = context;

        try {
          // SPA Angular - esperamos a que angular cargue el view
          await page.waitForSelector('epzb-spinner.ng-hide', { timeout: 15000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2000));

          // 1. Ir a la sección de búsqueda de permisos (si no estamos ahí)
          // Asumimos que la URL de entrada ya apunta a la vista de búsqueda

          // 2. Extraer datos de la tabla (ng-repeat)
          const rows = await page.evaluate((maxItems) => {
            const data = [];
            // Selectores CSS específicos de ePZB (Angular ng-repeat o ui-grid)
            const rowElements = Array.from(document.querySelectorAll('.table-striped tbody tr, [ng-repeat*="permit in"], .ui-grid-row'));

            rowElements.slice(0, maxItems).forEach(row => {
              // ePZB mapea los datos dentro de celdas
              const cells = Array.from(row.querySelectorAll('td, .ui-grid-cell-contents'));
              if (cells.length < 4) return;
              const getText = (idx) => cells[idx] ? cells[idx].textContent.trim() : null;

              data.push({
                permitNumber:   getText(0), // usualmente el primer campo
                permitType:     getText(1) || getText(2),
                permitDate:     getText(3) || getText(4),
                status:         getText(5),
                address:        getText(6) || getText(7),
                ownerName:      null,
                contractorName: null,
                valuation:      null,
              });
            });
            return data;
          }, ${maxItems});

          log.info('Palm Beach ePZB scraped: ' + rows.length + ' rows');
          return [{ permits: rows, county: 'Palm Beach', source: request.url }];
        } catch(e) {
          log.error('Palm Beach error: ' + e.message);
          return [{ permits: [], county: 'Palm Beach', error: e.message }];
        }
      }
    `;
  }
};
