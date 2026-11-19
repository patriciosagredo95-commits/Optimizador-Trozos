"""Servidor local y sincronización periódica del aserradero."""
import copy
from datetime import date, datetime, timedelta
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import mimetypes
import os
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit

try:
    from . import prd
except ImportError:
    import prd

CARPETA = Path(__file__).resolve().parent
CACHE = CARPETA / "cache" / "prd_dias.json"
DEFAULT = {"base": "http://SERVIDOR/RUTA/", "credencial": "PRD_SYNC_Glover", "puerto": 8766,
           "turno_inicio": "08:00", "turno_fin": "16:30", "colacion": ["12:00", "13:00"],
           "intervalo_turno_min": 2, "intervalo_fuera_min": 10, "dias_historico": 60, "origenes_extra": []}
FALTA_CONFIG = "Falta servicio/config.local.json con la dirección del PRD"


def origen_permitido(origen, extras=()):
    if origen is None:
        return True
    if origen in ("null", "https://planificacion-aserradero.industrial-glover.workers.dev") or origen in extras:
        return True
    try:
        u = urlsplit(origen)
        return (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1")
                and u.port is not None and not u.username and not u.password
                and not u.path and not u.query and not u.fragment)
    except ValueError:
        return False


def filtrar_historico(dias, hoy, cantidad, consultado=None):
    cantidad = max(1, min(120, int(cantidad)))
    desde, hasta = hoy - timedelta(days=cantidad), hoy - timedelta(days=1)
    campos = {"f", "produccion", "consumo", "trozos", "trozosPLC", "piezas", "tickets", "productos", "diametros", "pilas", "horas"}
    filas = [{k: v for k, v in r.items() if k in campos} for f, r in sorted(dias.items())
             if desde.isoformat() <= f <= hasta.isoformat() and (r.get("produccion") or r.get("consumo"))]
    return {"consultado": consultado, "desde": desde.isoformat(), "hasta": hasta.isoformat(), "dias": filas}


def cargar_config():
    config = DEFAULT.copy()
    try:
        local = json.loads((CARPETA / "config.local.json").read_text(encoding="utf-8-sig"))
        config.update(local)
        if "intervalo_hoy_min" in local and "intervalo_fuera_min" not in local:
            config["intervalo_fuera_min"] = local["intervalo_hoy_min"]
        base = urlsplit(config["base"])
        if base.scheme not in ("http", "https") or not base.hostname or base.hostname.upper() == "SERVIDOR":
            return config, FALTA_CONFIG
        config["base"] = config["base"].rstrip("/") + "/"
        config["puerto"] = int(config["puerto"])
        for campo in ("intervalo_turno_min", "intervalo_fuera_min"):
            config[campo] = float(config[campo])
        for hora in (config["turno_inicio"], config["turno_fin"], *config["colacion"]):
            datetime.strptime(hora, "%H:%M")
        if len(config["colacion"]) != 2:
            raise ValueError
        config["dias_historico"] = int(config["dias_historico"])
        if not (1 <= config["puerto"] <= 65535 and 0 < config["intervalo_turno_min"] < float("inf")
                and 0 < config["intervalo_fuera_min"] < float("inf")
                and 1 <= config["dias_historico"] <= 120):
            raise ValueError
        if not isinstance(config["origenes_extra"], list):
            raise ValueError
        return config, None
    except FileNotFoundError:
        return config, FALTA_CONFIG
    except (ValueError, TypeError, KeyError):
        return DEFAULT.copy(), "Configuración local no válida; revisa servicio/config.local.json"


def en_turno(config, ahora):
    inicio = datetime.strptime(config.get("turno_inicio", DEFAULT["turno_inicio"]), "%H:%M")
    fin = datetime.strptime(config.get("turno_fin", DEFAULT["turno_fin"]), "%H:%M")
    a = inicio.hour * 60 + inicio.minute - 15
    b = fin.hour * 60 + fin.minute + 30
    if b < a:
        b += 1440
    minuto = ahora.hour * 60 + ahora.minute + ahora.second / 60
    return any(a <= minuto + desplazamiento <= b for desplazamiento in (-1440, 0, 1440))


def intervalo_actual(config, ahora):
    if en_turno(config, ahora):
        return config.get("intervalo_turno_min", DEFAULT["intervalo_turno_min"])
    return config.get("intervalo_fuera_min", config.get("intervalo_hoy_min", DEFAULT["intervalo_fuera_min"]))


def unir_muestras(fecha, anteriores, nuevas):
    muestras = {m["t"]: m for m in [*anteriores, *nuevas]
                if m.get("t") and m["t"][:10] == fecha}
    return [muestras[t] for t in sorted(muestras)]


class Estado:
    def __init__(self, config, error):
        self.lock = threading.Lock()
        self.config = config
        self.dias = {}
        self.hoy = None
        self.estado = {"ok": True, "servicio": "prd-aserradero", "version": 1,
            "intervaloMin": intervalo_actual(config, datetime.now()),
            "turno": {"inicio": config.get("turno_inicio", DEFAULT["turno_inicio"]),
                      "fin": config.get("turno_fin", DEFAULT["turno_fin"]),
                      "colacion": config.get("colacion", DEFAULT["colacion"])}, "hoyConsultado": None,
            "historicoConsultado": None, "error": error}

    def cargar(self):
        try:
            datos = json.loads(CACHE.read_text(encoding="utf-8"))
            if datos["version"] != 3 or not isinstance(datos["dias"], dict):
                raise ValueError("Formato de caché no válido")
            with self.lock:
                self.dias = datos["dias"]
                actual = self.dias.get(date.today().isoformat())
                if actual and "sensor" in actual:
                    self.hoy = actual
                    self.estado["hoyConsultado"] = actual.get("consultado")
                anteriores = [r.get("consultado") for f, r in self.dias.items()
                              if f < date.today().isoformat() and r.get("consultado")]
                self.estado["historicoConsultado"] = max(anteriores, default=None)
        except FileNotFoundError:
            pass
        except (ValueError, KeyError, TypeError, OSError):
            logging.warning("No se pudo cargar el caché; se consultará nuevamente")

    def guardar(self, registro):
        with self.lock:
            registro = copy.deepcopy(registro)
            if "plcMuestras" in registro:
                registro["plcMuestras"] = unir_muestras(registro["f"],
                    self.dias.get(registro["f"], {}).get("plcMuestras", []), registro["plcMuestras"])
            self.dias[registro["f"]] = registro
            if registro["f"] == date.today().isoformat() and "sensor" in registro:
                self.hoy = registro
                self.estado["hoyConsultado"] = registro["consultado"]
            else:
                self.estado["historicoConsultado"] = registro["consultado"]
            datos = {"version": 3, "dias": copy.deepcopy(self.dias)}
        CACHE.parent.mkdir(exist_ok=True)
        # El temporal se crea junto al destino para que el reemplazo sea atómico.
        nombre = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=CACHE.parent, delete=False) as archivo:
                nombre = archivo.name
                json.dump(datos, archivo, ensure_ascii=False)
                archivo.flush()
                os.fsync(archivo.fileno())
            os.replace(nombre, CACHE)
        finally:
            if nombre and os.path.exists(nombre):
                os.unlink(nombre)


def _detalle(exc, cred=None):
    """Tipo y mensaje corto de una excepción para el log local, sin la clave."""
    texto = f"{type(exc).__name__}: {exc}"[:400]
    if cred and cred[1]:
        texto = texto.replace(cred[1], "***")
    return texto


def host_permitido(host, puerto):
    """Solo se atiende a localhost/127.0.0.1 en el puerto del servicio (evita lecturas por DNS rebinding)."""
    return (host or "").strip().lower() in (f"localhost:{puerto}", f"127.0.0.1:{puerto}")


class SesionPRD:
    """Todos los objetos Playwright pertenecen al hilo de sincronización."""
    def __init__(self, config):
        self.config = config
        self.runtime = self.navegador = self.page = None
        self.inicio = 0

    def cerrar(self):
        try:
            if self.page is not None:
                self.page.goto(self.config["base"] + "Login.aspx", timeout=15000)
        except Exception:
            logging.warning("No se pudo cerrar la sesión PRD")
        finally:
            try:
                if self.navegador is not None:
                    self.navegador.close()
            except Exception:
                logging.warning("No se pudo cerrar el navegador PRD")
            finally:
                try:
                    if self.runtime is not None:
                        self.runtime.stop()
                except Exception:
                    logging.warning("No se pudo detener Playwright")
                finally:
                    self.runtime = self.navegador = self.page = None

    def abrir(self, cred):
        if self.page is not None and time.monotonic() - self.inicio >= 3600:
            self.cerrar()
        if self.page is None:
            from playwright.sync_api import sync_playwright
            self.runtime = sync_playwright().start()
            self.navegador = self.runtime.chromium.launch(channel="chrome", headless=True)
            self.page = self.navegador.new_page()
            prd.iniciar_sesion(self.page, self.config["base"], cred)
            self.inicio = time.monotonic()
        return self.page


def sincronizar(estado, detener, error_config):
    estado.cargar()
    ultimo_historico = 0
    ultima_fecha = None
    sesion = SesionPRD(estado.config)
    try:
        while not detener.is_set():
            hoy = date.today()
            with estado.lock:
                existentes = set(estado.dias)
            ampliar = hoy != ultima_fecha or time.monotonic() - ultimo_historico >= 3600
            fechas = [hoy] + [hoy - timedelta(days=n)
                for n in range(1, max(3, estado.config["dias_historico"]) + 1)
                if (ampliar and n <= 3) or (hoy - timedelta(days=n)).isoformat() not in existentes]
            cred = None
            fallos_historico = 0
            with estado.lock:
                estado.estado["intervaloMin"] = intervalo_actual(estado.config, datetime.now())
            try:
                if error_config:
                    raise RuntimeError(error_config)
                cred = prd.credencial(estado.config["credencial"])
                if cred is None:
                    raise RuntimeError('No hay clave guardada "PRD_SYNC_Glover". Ejecuta en una consola: '
                                       'cmdkey /generic:PRD_SYNC_Glover /user:USUARIO /pass')
                page = sesion.abrir(cred)
                for fecha in fechas:
                    if detener.is_set():
                        break
                    texto = prd.consultar_dia(page, fecha)
                    if "login.aspx" in page.url.lower() or str(texto).lstrip().startswith("<"):
                        raise RuntimeError("La sesión PRD expiró")
                    try:
                        registro = (prd.parse_hoy if fecha == hoy else prd.parse_dia)(texto, fecha)
                    except ValueError as exc:
                        if fecha == hoy:
                            raise
                        # Un día con datos raros no detiene el resto ni reinicia la sesión; se reintenta luego.
                        fallos_historico += 1
                        logging.warning("Día %s no se pudo leer: %s", fecha, _detalle(exc, cred))
                        continue
                    registro["consultado"] = datetime.now().isoformat(timespec="seconds")
                    estado.guardar(registro)
                if not detener.is_set() and ampliar and not fallos_historico:
                    ultimo_historico, ultima_fecha = time.monotonic(), hoy
                with estado.lock:
                    estado.estado["error"] = None
            except Exception as exc:
                mensaje = str(exc) if isinstance(exc, RuntimeError) else "Falló la consulta al PRD; se reintentará en el próximo ciclo."
                logging.error("%s | %s", mensaje, _detalle(exc, cred))
                with estado.lock:
                    estado.estado["error"] = mensaje
                sesion.cerrar()
            if not en_turno(estado.config, datetime.now()):
                sesion.cerrar()
            # Revisar el reloj permite adoptar la frecuencia nueva al entrar al turno.
            inicio_espera = time.monotonic()
            while not detener.is_set():
                restante = intervalo_actual(estado.config, datetime.now()) * 60 - (time.monotonic() - inicio_espera)
                if restante <= 0:
                    break
                detener.wait(min(30, restante))
    finally:
        sesion.cerrar()


class Atender(BaseHTTPRequestHandler):
    def cabeceras(self, codigo, tipo, largo, opciones=False):
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(largo))
        self.send_header("Cache-Control", "no-store")
        if urlsplit(self.path).path.startswith("/api/"):
            self.send_header("Vary", "Origin")
            origen = self.headers.get("Origin")
            if origen is not None and origen_permitido(origen, self.server.datos.config["origenes_extra"]):
                self.send_header("Access-Control-Allow-Origin", origen)
            if opciones:
                for k, v in {"Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*",
                             "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600"}.items():
                    self.send_header(k, v)
        self.end_headers()

    def respuesta(self, codigo, datos):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.cabeceras(codigo, "application/json; charset=utf-8", len(cuerpo))
        self.wfile.write(cuerpo)

    def autorizado(self):
        return origen_permitido(self.headers.get("Origin"), self.server.datos.config["origenes_extra"])

    def do_OPTIONS(self):
        if not host_permitido(self.headers.get("Host"), self.server.datos.config["puerto"]):
            return self.respuesta(403, {"error": "Host no permitido"})
        if not urlsplit(self.path).path.startswith("/api/"):
            return self.respuesta(404, {"error": "No se encontró la ruta"})
        if not self.autorizado():
            return self.respuesta(403, {"error": "Origen no permitido"})
        self.cabeceras(204, "text/plain", 0, opciones=True)

    def do_GET(self):
        ruta = urlsplit(self.path)
        estado = self.server.datos
        if not host_permitido(self.headers.get("Host"), estado.config["puerto"]):
            return self.respuesta(403, {"error": "Host no permitido"})
        if ruta.path.startswith("/api/"):
            if not self.autorizado():
                return self.respuesta(403, {"error": "Origen no permitido"})
            with estado.lock:
                if ruta.path == "/api/estado":
                    resultado = copy.deepcopy(estado.estado)
                    resultado["intervaloMin"] = intervalo_actual(estado.config, datetime.now())
                elif ruta.path == "/api/hoy":
                    resultado = copy.deepcopy(estado.hoy)
                    if not resultado or resultado["f"] != date.today().isoformat():
                        return self.respuesta(503, {"error": "Aún no hay datos de hoy; el servicio está consultando el PRD."})
                elif ruta.path == "/api/historico":
                    try:
                        cantidad = int(parse_qs(ruta.query).get("dias", ["30"])[0])
                    except ValueError:
                        return self.respuesta(400, {"error": "dias debe ser un entero entre 1 y 120"})
                    resultado = filtrar_historico(estado.dias, date.today(), cantidad, estado.estado["historicoConsultado"])
                else:
                    return self.respuesta(404, {"error": "No se encontró la ruta"})
            return self.respuesta(200, resultado)
        raiz = (CARPETA.parent / "dist").resolve()
        try:
            archivo = (raiz / unquote(ruta.path).lstrip("/")).resolve()
        except (ValueError, OSError):
            return self.respuesta(404, {"error": "No se encontró el archivo"})
        if ruta.path == "/":
            archivo = raiz / "index.html"
        if not archivo.is_relative_to(raiz) or not archivo.is_file():
            return self.respuesta(404, {"error": "No se encontró el archivo"})
        try:
            cuerpo = archivo.read_bytes()
        except OSError:
            return self.respuesta(404, {"error": "No se encontró el archivo"})
        tipo = {".js": "text/javascript", ".css": "text/css", ".png": "image/png",
                ".json": "application/json", ".svg": "image/svg+xml"}.get(archivo.suffix.lower())
        self.cabeceras(200, tipo or mimetypes.guess_type(archivo.name)[0] or "application/octet-stream", len(cuerpo))
        self.wfile.write(cuerpo)

    def log_message(self, formato, *args):
        logging.info(formato, *args)


def main():
    log = Path(tempfile.gettempdir()) / "servicio_prd_aserradero.log"
    modo = "w" if log.exists() and log.stat().st_size > 1024 * 1024 else "a"
    logging.basicConfig(filename=log, filemode=modo, encoding="utf-8", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    config, error = cargar_config()
    estado = Estado(config, error)
    try:
        servidor = ThreadingHTTPServer(("127.0.0.1", config["puerto"]), Atender)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE or getattr(exc, "winerror", None) == 10048:
            logging.info("Ya hay otra instancia en el puerto %s", config["puerto"])
            return 0
        logging.error("No se pudo abrir el servidor local")
        return 1
    servidor.datos = estado
    detener = threading.Event()
    hilo = threading.Thread(target=sincronizar, args=(estado, detener, error), daemon=True)
    hilo.start()
    logging.info("Servicio iniciado en el puerto %s", config["puerto"])
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        detener.set()
        servidor.server_close()
        hilo.join()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
