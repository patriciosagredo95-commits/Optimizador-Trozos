"""Operaciones con fixtures sintéticas, sin PRD ni credenciales."""
import json
from datetime import date, datetime
from pathlib import Path
import unittest
from unittest.mock import patch, Mock
from servicio import servicio_prd as servicio
from servicio.prd import parse_dia, parse_hoy


class Operaciones(unittest.TestCase):
    def test_plc_y_calidad(self):
        f = "2026-01-07"
        datos = {"Datos": {"Calidad": {"TicketsSinFechaTurno": "3",
            "TicketsFueraHorario": 2, "ConsumosFueraHorario": 4}},
            "ContadorDias": [{"Dia": f, "TrozosPLC": 10},
                {"Dia": f + "T00:00:00", "TrozosPLC": 5},
                {"Dia": "2026-01-06", "TrozosPLC": 99}]}
        self.assertEqual(parse_dia(json.dumps(datos), f)["trozosPLC"], 15)
        self.assertEqual(parse_dia('{"Datos":{}}', f)["trozosPLC"], 0)
        self.assertEqual(parse_hoy(json.dumps(datos), f)["calidad"],
            {"paquetesSinTurno": 3, "paquetesFueraHorario": 2, "consumosFueraHorario": 4})
        self.assertEqual(set(parse_hoy('{"Datos":{}}', f)["calidad"].values()), {0})
        registro = parse_dia(json.dumps(datos), f)
        registro["produccion"] = 1
        self.assertEqual(servicio.filtrar_historico({f: registro}, date(2026, 1, 8), 1)["dias"][0]["trozosPLC"], 15)

    def test_muestras_sensor(self):
        f = "2026-01-07"
        d = {"Datos": {}, "Config": {"ContadorTagId": 1}, "Sensores": [
            {"TagId": 1, "Status": "OK", "Valor": "42", "LastSeenTime": f + "T08:00:00"}]}
        self.assertEqual(parse_hoy(json.dumps(d), f)["plcMuestras"], [{"t": f + "T08:00:00", "valor": 42}])
        d["Sensores"][0]["Fresco"] = False
        self.assertEqual(parse_hoy(json.dumps(d), f)["plcMuestras"], [])
        d["Sensores"] = []
        self.assertEqual(parse_hoy(json.dumps(d), f)["plcMuestras"], [])

    def test_guardar_muestras_y_cache(self):
        f = date.today().isoformat()
        a = {"t": f + "T08:00:00", "valor": 50}
        b = {"t": f + "T09:00:00", "valor": 3}
        ajena = {"t": "2000-01-01T09:00:00", "valor": 100}
        archivo = Mock()
        archivo.__enter__ = Mock(return_value=archivo)
        archivo.__exit__ = Mock(return_value=False)
        archivo.name = "cache-sintetico"
        with patch.object(servicio.tempfile, "NamedTemporaryFile", return_value=archivo), \
                patch.object(Path, "mkdir"), patch.object(servicio.os, "fsync"), \
                patch.object(servicio.os, "replace"), patch.object(servicio.os.path, "exists", return_value=False):
            estado = servicio.Estado(servicio.DEFAULT.copy(), None)
            def guardar(muestras):
                estado.guardar({"f": f, "horas": [], "sensor": {}, "consultado": "prueba", "plcMuestras": muestras})
            guardar([b, a, ajena])
            guardar([a])
            self.assertEqual(estado.hoy["plcMuestras"], [a, b])
            for version in (3, 1, 2):
                with patch.object(Path, "read_text", return_value=json.dumps({"version": version, "dias": estado.dias})):
                    nuevo = servicio.Estado(servicio.DEFAULT.copy(), None)
                    nuevo.cargar()
                if version == 3:
                    self.assertEqual(nuevo.hoy["plcMuestras"], [a, b])
                else:
                    self.assertEqual(nuevo.dias, {})
                    self.assertIsNone(nuevo.hoy)

    def test_intervalos(self):
        for hora in ("07:45", "08:00", "12:30", "17:00"):
            self.assertEqual(servicio.intervalo_actual(servicio.DEFAULT, datetime.fromisoformat("2026-11-22T" + hora)), 2)
        for hora in ("07:44", "17:01", "23:00"):
            ahora = datetime.fromisoformat("2026-11-22T" + hora)
            self.assertEqual(servicio.intervalo_actual(servicio.DEFAULT, ahora), 10)
            self.assertEqual(servicio.intervalo_actual({"intervalo_hoy_min": 5}, ahora), 5)
            self.assertEqual(servicio.intervalo_actual({"intervalo_hoy_min": 5, "intervalo_fuera_min": 12}, ahora), 12)

    def test_config_antigua_sintetica(self):
        with patch.object(Path, "read_text", return_value=json.dumps({"base": "http://prd.test/", "intervalo_hoy_min": 7})):
            config, error = servicio.cargar_config()
        self.assertIsNone(error)
        self.assertEqual(config["intervalo_fuera_min"], 7)

    def test_sesion_renueva_y_cierra(self):
        sesion = servicio.SesionPRD(servicio.DEFAULT)
        pagina, navegador, runtime = Mock(), Mock(), Mock()
        sesion.page, sesion.navegador, sesion.runtime = pagina, navegador, runtime
        sesion.inicio = 100
        with patch.object(servicio.time, "monotonic", return_value=200):
            self.assertIs(sesion.abrir(None), pagina)
        sesion.cerrar()
        pagina.goto.assert_called_once()
        navegador.close.assert_called_once()
        runtime.stop.assert_called_once()
        self.assertIsNone(sesion.page)

    def test_renovacion_a_los_60_minutos(self):
        import sys
        sesion = servicio.SesionPRD(servicio.DEFAULT)
        anterior, navegador, runtime = Mock(), Mock(), Mock()
        sesion.page, sesion.navegador, sesion.runtime = anterior, navegador, runtime
        sesion.inicio = 100
        api = Mock()
        nuevo_runtime = api.sync_playwright.return_value.start.return_value
        nueva = nuevo_runtime.chromium.launch.return_value.new_page.return_value
        with patch.dict(sys.modules, {"playwright.sync_api": api}), \
                patch.object(servicio.prd, "iniciar_sesion") as login, \
                patch.object(servicio.time, "monotonic", return_value=3700):
            self.assertIs(sesion.abrir(("usuario", "clave")), nueva)
            login.assert_called_once_with(nueva, servicio.DEFAULT["base"], ("usuario", "clave"))
        anterior.goto.assert_called_once()
        navegador.close.assert_called_once()
        runtime.stop.assert_called_once()
        nuevo_runtime.chromium.launch.assert_called_once_with(channel="chrome", headless=True)

    def test_cierre_ante_navegador_roto(self):
        sesion = servicio.SesionPRD(servicio.DEFAULT)
        sesion.page, sesion.navegador, sesion.runtime = Mock(), Mock(), Mock()
        sesion.page.goto.side_effect = RuntimeError("pagina cerrada")
        sesion.navegador.close.side_effect = RuntimeError("navegador cerrado")
        runtime = sesion.runtime
        sesion.cerrar()
        runtime.stop.assert_called_once()
        self.assertIsNone(sesion.page)
