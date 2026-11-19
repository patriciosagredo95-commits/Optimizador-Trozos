"""Pruebas sintéticas: no requieren Chrome, credenciales ni red."""
from datetime import date
import json
import unittest
from servicio.prd import parse_dia, parse_hoy
from servicio.servicio_prd import _detalle, filtrar_historico, host_permitido, origen_permitido

FECHA = "2026-01-07"


def fixture():
    return {"Datos": {"Dias": [{"Dia": FECHA + "T00:00:00", "Produccion": 10.5,
        "Consumo": 20.4096, "Trozos": 50, "Piezas": 900, "Tickets": 3}],
        "Productos": [{"Codigo": "FICTICIO", "Descripcion": "50X50X4000", "Calidad": "Prueba",
                       "M3": 10.5, "Piezas": 900, "Tickets": 3}],
        "Diametros": [{"Diametro": 32, "Largo": 4, "Trozos": 1, "M3": 0.4096}],
        "Pilas": [{"Pila": "Prueba", "Produccion": 10.5, "Consumo": 20.4096, "Trozos": 50, "Tickets": 3}],
        "Horas": [{"Hora": FECHA + "T09:00:00", "Produccion": 10.5, "Consumo": 20.4096, "Trozos": 50}],
        "EscuadriasHora": [{"Hora": FECHA + "T09:00:00", "Pila": "Prueba", "Escuadria": "50X50X4000",
                            "Produccion": 10.5, "Piezas": 900}]},
        "Ahora": FECHA + "T10:15:08.579", "Config": {"ContadorTagId": 7},
        "Sensores": [{"TagId": 7, "TagName": "Sensor prueba", "Status": "OK", "Valor": 58,
                       "LastSeenTime": FECHA + "T10:15:08.277"}],
        "ContadorDias": [{"Dia": FECHA, "TrozosPLC": 57}, {"Dia": "2026-01-06", "TrozosPLC": 999}],
        "ContadorHoras": [{"Hora": FECHA + "T08:00:00", "TrozosPLC": 24},
                          {"Hora": FECHA + "T09:00:00", "TrozosPLC": 33},
                          {"Hora": "2026-01-06T09:00:00", "TrozosPLC": 999}]}


def texto(d):
    return json.dumps({"d": json.dumps(d)})


class Parsers(unittest.TestCase):
    def test_dia_normal(self):
        r = parse_dia(texto(fixture()), FECHA)
        horas = r.pop("horas")
        self.assertTrue(all(set(h) == {"h", "produccion", "consumo", "trozos", "trozosPLC"} for h in horas))
        self.assertEqual([h["h"] for h in horas], sorted(h["h"] for h in horas))
        self.assertEqual(r, {"f": FECHA, "produccion": 10.5, "consumo": 20.4096, "trozos": 50,
            "piezas": 900, "tickets": 3, "trozosPLC": 57,
            "productos": [{"codigo": "FICTICIO", "esc": "50X50X4000", "calidad": "Prueba", "m3": 10.5, "piezas": 900, "paq": 3}],
            "diametros": [{"d": 32, "largo": 4, "trozos": 1, "m3": 0.4096}],
            "pilas": [{"pila": "Prueba", "produccion": 10.5, "consumo": 20.4096, "trozos": 50, "paq": 3}]})

    def test_sin_datos(self):
        d = fixture()
        d["Datos"]["Dias"] = []
        r = parse_dia(texto(d), FECHA)
        for k in ("produccion", "consumo", "trozos", "piezas", "tickets"):
            self.assertEqual(r[k], 0)
        for k in ("productos", "diametros", "pilas"):
            self.assertEqual(r[k], [])

    def test_hoy(self):
        r = parse_hoy(texto(fixture()), FECHA)
        self.assertEqual(r["ahora"], FECHA + "T10:15:08")
        self.assertEqual(r["trozosPLC"], 57)
        self.assertEqual(r["horas"], [
            {"h": "08:00", "produccion": 0, "consumo": 0, "trozos": 0, "trozosPLC": 24},
            {"h": "09:00", "produccion": 10.5, "consumo": 20.4096, "trozos": 50, "trozosPLC": 33}])
        self.assertEqual(r["sensor"], {"nombre": "Sensor prueba", "estado": "OK", "valor": 58,
                                      "visto": FECHA + "T10:15:08"})
        self.assertEqual(r["escuadriasHora"], [{"h": "09:00", "pila": "Prueba", "esc": "50X50X4000", "m3": 10.5, "piezas": 900}])

    def test_sensor_sin_senal_y_sin_sensor(self):
        d = fixture()
        d["Sensores"][0]["Fresco"] = False
        self.assertEqual(parse_hoy(texto(d), FECHA)["sensor"]["estado"], "Sin señal")
        d["Config"]["ContadorTagId"] = 99
        self.assertEqual(parse_hoy(texto(d), FECHA)["sensor"]["estado"], "Sin sensor")

    def test_formatos_y_respuesta_invalida(self):
        self.assertEqual(parse_dia("\ufeff200|" + texto(fixture()), FECHA)["tickets"], 3)
        self.assertEqual(parse_dia(json.dumps({"d": fixture()}), FECHA)["tickets"], 3)
        with self.assertRaises(ValueError):
            parse_dia('{"d":{}}', FECHA)


class ApiPura(unittest.TestCase):
    def test_origenes(self):
        for o in (None, "null", "http://localhost:80", "http://127.0.0.1:8766",
                  "https://planificacion-aserradero.industrial-glover.workers.dev"):
            self.assertTrue(origen_permitido(o), o)
        for o in ("https://localhost:80", "http://localhost.ejemplo:80", "http://localhost:80/ruta",
                  "http://usuario@localhost:80", "http://localhost:mal", "https://otro.ejemplo", "http://[mal"):
            self.assertFalse(origen_permitido(o), o)
        self.assertTrue(origen_permitido("https://extra.ejemplo", ["https://extra.ejemplo"]))

    def test_ventana_historico(self):
        dias = {f: {"f": f, "produccion": p, "consumo": c, "consultado": "prueba"} for f, p, c in
                [("2026-01-07", 99, 99), ("2026-01-06", 1, 0), ("2026-01-05", 0, 2),
                 ("2026-01-04", 0, 0), ("2026-01-03", 3, 3)]}
        r = filtrar_historico(dias, date(2026, 1, 7), 3, "lectura")
        self.assertEqual([d["f"] for d in r["dias"]], ["2026-01-05", "2026-01-06"])
        self.assertEqual((r["desde"], r["hasta"], r["consultado"]), ("2026-01-04", "2026-01-06", "lectura"))
        self.assertNotIn("consultado", r["dias"][0])
        self.assertEqual(filtrar_historico({}, date(2026, 1, 7), 0)["desde"], "2026-01-06")
        self.assertEqual(filtrar_historico({}, date(2026, 1, 7), 999)["desde"], "2025-09-09")

    def test_host_y_detalle(self):
        for h in ("localhost:8766", "127.0.0.1:8766", "LOCALHOST:8766"):
            self.assertTrue(host_permitido(h, 8766), h)
        for h in (None, "", "malo.ejemplo:8766", "localhost:8080", "127.0.0.1"):
            self.assertFalse(host_permitido(h, 8766), h)
        texto = _detalle(RuntimeError("fallo con clave secreta123"), ("u", "secreta123"))
        self.assertNotIn("secreta123", texto)
        self.assertIn("RuntimeError", texto)


if __name__ == "__main__":
    unittest.main()
