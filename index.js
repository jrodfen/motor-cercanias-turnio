const axios = require('axios');
const AdmZip = require('adm-zip');
const csv = require('csv-parser');
const fs = require('fs');
const { Readable } = require('stream');

// 🔴 PON AQUÍ LOS ENLACES DIRECTOS A LOS ZIP DE DATA.RENFE.COM
const URL_CERCANIAS = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"; 
const URL_MDLD = "https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip"; 

// Función para leer un archivo txt desde el ZIP en memoria
function leerCSVdesdeZIP(zip, fileName) {
    return new Promise((resolve, reject) => {
        const entry = zip.getEntry(fileName);
        if (!entry) {
            console.log(`⚠️ Archivo ${fileName} no encontrado en el ZIP.`);
            return resolve([]);
        }
        
        const results = [];
        const bufferStream = new Readable();
        bufferStream.push(entry.getData());
        bufferStream.push(null);

        bufferStream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

async function procesarMalla(url, archivoSalida, tipoMalla) {
    try {
        console.log(`\n🚀 Iniciando procesamiento de: ${tipoMalla}`);
        console.log("📥 Descargando ZIP desde Renfe (esto puede tardar)...");
        
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const zip = new AdmZip(response.data);
        console.log("📦 ZIP descargado. Extrayendo datos...");

        // Extraer todos los TXT a memoria
        const stops = await leerCSVdesdeZIP(zip, 'stops.txt');
        const routes = await leerCSVdesdeZIP(zip, 'routes.txt');
        const trips = await leerCSVdesdeZIP(zip, 'trips.txt');
        const stopTimes = await leerCSVdesdeZIP(zip, 'stop_times.txt');
        const calendar = await leerCSVdesdeZIP(zip, 'calendar.txt');

        console.log("⚙️ Procesando y cruzando datos...");

        let estaciones = {};
        stops.forEach(s => { estaciones[s.stop_id] = s.stop_name; });

        let calendarios = {};
        calendar.forEach(c => { calendarios[c.service_id] = { start: c.start_date, end: c.end_date }; });

        let rutasMap = {};
        routes.forEach(r => { rutasMap[r.route_id] = r; });

        let viajes = {};
        trips.forEach(t => {
            let r = rutasMap[t.route_id] || {};
            
            viajes[t.trip_id] = {
                numero_tren: t.trip_short_name || t.trip_id,
                nombreVisualFrontal: r.route_short_name || tipoMalla,
                productoFiltro: r.route_long_name || tipoMalla,
                lineaTren: r.route_short_name || "",
                accesible: t.wheelchair_accessible === "1",
                unidad: "N/D",
                service_id: t.service_id,
                esCercanias: tipoMalla === "Cercanías"
            };
        });

        // Agrupar stop_times por trip_id y calcular límites
        let horariosFiltrados = [];
        let limitesViajes = {};
        
        // Agrupamos en un mapa temporal
        let paradasPorViaje = {};
        stopTimes.forEach(st => {
            if (!viajes[st.trip_id]) return; 
            
            if (!paradasPorViaje[st.trip_id]) paradasPorViaje[st.trip_id] = [];
            paradasPorViaje[st.trip_id].push({
                trip_id: st.trip_id,
                stop_id: st.stop_id,
                arrival_time: st.arrival_time,
                departure_time: st.departure_time,
                stop_sequence: parseInt(st.stop_sequence)
            });
        });

        // Calcular min, max, origen y destino
        for (let tripId in paradasPorViaje) {
            let paradas = paradasPorViaje[tripId];
            paradas.sort((a, b) => a.stop_sequence - b.stop_sequence); 
            
            let pOrigen = paradas[0];
            let pDestino = paradas[paradas.length - 1];

            limitesViajes[tripId] = {
                min: pOrigen.stop_sequence,
                max: pDestino.stop_sequence,
                origen: pOrigen.stop_id,
                destino: pDestino.stop_id,
                hora_llegada_destino: pDestino.arrival_time || pDestino.departure_time
            };

            // Añadir al array global
            horariosFiltrados.push(...paradas);
        }

        // Crear objeto final JSON
        const jsonFinal = {
            ultimaActualizacion: new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }),
            estaciones: estaciones,
            horarios: horariosFiltrados,
            viajes: viajes,
            calendarios: calendarios,
            limitesViajes: limitesViajes
        };

        console.log(`💾 Guardando archivo ${archivoSalida} (aprox ${Math.round(JSON.stringify(jsonFinal).length / 1024 / 1024)} MB)...`);
        fs.writeFileSync(archivoSalida, JSON.stringify(jsonFinal));
        console.log(`✅ ${tipoMalla} procesado con éxito.`);

    } catch (error) {
        console.error(`❌ Error procesando ${tipoMalla}:`, error);
    }
}

async function ejecutarTodo() {
    console.log("🚂 INICIANDO MOTOR GTFS TURNIO 🚂");
    
    await procesarMalla(URL_CERCANIAS, "cercanias_opt.json", "Cercanías");
    await procesarMalla(URL_MDLD, "mdld_opt.json", "Larga y Media Distancia");
    
    console.log("🏁 PROCESO GLOBAL FINALIZADO.");
}

ejecutarTodo();
