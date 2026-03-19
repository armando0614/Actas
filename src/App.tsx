/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Users, 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Download, 
  FileDown, 
  LogOut, 
  Calendar,
  Briefcase,
  User,
  ChevronRight,
  BarChart3,
  Moon,
  Sun,
  AlertCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface ActaRecord {
  id: string;
  fullName: string;
  position: string;
  reason: string;
  date: string;
  createdAt: number;
}

// --- Constants ---
const STORAGE_KEY = 'actas_records_v1';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '1234';

export default function App() {
  // --- State ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ user: '', pass: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [records, setRecords] = useState<ActaRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'records' | 'stats'>('dashboard');
  const [darkMode, setDarkMode] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState({ fullName: '', position: '', reason: '', date: format(new Date(), 'yyyy-MM-dd') });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  
  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [hasApiKey, setHasApiKey] = useState(false);

  // --- Effects ---
  useEffect(() => {
    const key = (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    const isValid = !!key && key !== 'MY_GEMINI_API_KEY';
    console.log("API Key detected:", isValid ? "YES" : "NO");
    setHasApiKey(isValid);
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setRecords(JSON.parse(saved));
      } catch (e) {
        console.error("Error loading records", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  // --- Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    
    const inputUser = loginForm.user.trim().toLowerCase();
    const inputPass = loginForm.pass.trim();

    if (inputUser === ADMIN_USER.toLowerCase() && inputPass === ADMIN_PASS) {
      setIsLoggedIn(true);
    } else {
      setLoginError("Usuario o contraseña incorrectos");
    }
  };

  const handleBypass = () => {
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setLoginForm({ user: '', pass: '' });
  };

  const handleSaveRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.position || !formData.date) return;

    if (editingId) {
      setRecords(prev => prev.map(r => r.id === editingId ? { ...r, ...formData } : r));
      setEditingId(null);
    } else {
      const newRecord: ActaRecord = {
        id: crypto.randomUUID(),
        ...formData,
        createdAt: Date.now()
      };
      setRecords(prev => [newRecord, ...prev]);
    }
    setFormData({ fullName: '', position: '', reason: '', date: format(new Date(), 'yyyy-MM-dd') });
  };

  const handleDelete = (id: string) => {
    if (confirm("¿Estás seguro de eliminar este registro?")) {
      setRecords(prev => prev.filter(r => r.id !== id));
    }
  };

  const handleEdit = (record: ActaRecord) => {
    setFormData({ fullName: record.fullName, position: record.position, reason: record.reason || '', date: record.date });
    setEditingId(record.id);
    setActiveTab('records');
  };

  const handleExtractFromImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          if (result.includes(',')) {
            resolve(result.split(',')[1]);
          } else {
            reject(new Error("Error al procesar la imagen. Formato no válido."));
          }
        };
        reader.onerror = () => reject(new Error("Error al leer el archivo."));
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const apiKey = 
        (import.meta as any).env?.VITE_GEMINI_API_KEY || 
        process.env.GEMINI_API_KEY || 
        '';
        
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        console.error("GEMINI_API_KEY is missing or is the placeholder.");
        throw new Error("La clave de API de Gemini no está configurada correctamente. Por favor, asegúrate de haberla añadido en la sección de Secretos (⚙️ -> Secrets) con el nombre GEMINI_API_KEY.");
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: file.type,
              },
            },
            {
              text: "Extract the full name, job position, date, and the reason (motivo) for the document. Return the data in JSON format.",
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fullName: { type: Type.STRING },
              position: { type: Type.STRING },
              reason: { type: Type.STRING, description: "The reason or motive for the record" },
              date: { type: Type.STRING, description: "Date in YYYY-MM-DD format" },
            },
            required: ["fullName", "position", "reason", "date"],
          },
        },
      });

      if (!response.text) {
        throw new Error("No se pudo obtener texto de la respuesta de la IA.");
      }

      const result = JSON.parse(response.text);
      if (result.fullName || result.position || result.date || result.reason) {
        setFormData({
          fullName: result.fullName || '',
          position: result.position || '',
          reason: result.reason || '',
          date: result.date || format(new Date(), 'yyyy-MM-dd'),
        });
      }
    } catch (error: any) {
      console.error("Error extracting data:", error);
      const message = error?.message || "Ocurrió un error inesperado.";
      alert(`No se pudo extraer la información de la imagen: ${message}`);
    } finally {
      setIsExtracting(false);
      // Reset file input
      e.target.value = '';
    }
  };

  // --- Computed Data ---
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchesSearch = r.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           r.position.toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchesDate = true;
      if (dateFilter.start && dateFilter.end) {
        const recordDate = parseISO(r.date);
        matchesDate = isWithinInterval(recordDate, {
          start: startOfDay(parseISO(dateFilter.start)),
          end: endOfDay(parseISO(dateFilter.end))
        });
      }
      
      return matchesSearch && matchesDate;
    });
  }, [records, searchTerm, dateFilter]);

  const statsData = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach(r => {
      counts[r.fullName] = (counts[r.fullName] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [records]);

  // --- Exports ---
  const exportToExcel = () => {
    // Sort records by name to group them
    const sorted = [...filteredRecords].sort((a, b) => a.fullName.localeCompare(b.fullName));
    
    // Prepare data using Array of Arrays for custom formatting
    const data: any[][] = [
      ["SISTEMA DE CONTROL DE ACTAS"],
      [`REPORTE GENERADO EL: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`],
      [],
      ["NOMBRE COMPLETO", "PUESTO", "MOTIVO DEL ACTA", "FECHA"]
    ];

    let currentPerson = "";
    let personCount = 0;

    sorted.forEach((r, index) => {
      // If person changes, add a subtotal for the previous person
      if (currentPerson && r.fullName !== currentPerson) {
        data.push(["", "", `SUBTOTAL (${currentPerson}):`, `${personCount} acta(s)`]);
        data.push([]); // Spacer row
        personCount = 0;
      }
      
      data.push([r.fullName, r.position, r.reason, r.date]);
      currentPerson = r.fullName;
      personCount++;

      // Handle the last person in the list
      if (index === sorted.length - 1) {
        data.push(["", "", `SUBTOTAL (${currentPerson}):`, `${personCount} acta(s)`]);
      }
    });

    // Add final summary
    data.push([]);
    data.push(["RESUMEN GENERAL"]);
    data.push(["Total de Actas Registradas:", "", "", sorted.length]);
    data.push(["Total de Personas con Actas:", "", "", new Set(sorted.map(r => r.fullName)).size]);

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    
    // Define column widths for a professional look
    worksheet['!cols'] = [
      { wch: 35 }, // Nombre
      { wch: 25 }, // Puesto
      { wch: 60 }, // Motivo
      { wch: 15 }  // Fecha
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte de Actas");
    
    // Generate and download
    XLSX.writeFile(workbook, `Reporte_Actas_Profesional_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text("Reporte de Actas de Control", 14, 15);
    (doc as any).autoTable({
      startY: 20,
      head: [['Nombre', 'Puesto', 'Motivo', 'Fecha']],
      body: filteredRecords.map(r => [r.fullName, r.position, r.reason, r.date]),
    });
    doc.save(`Reporte_Actas_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  // --- Render Login ---
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-900 p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500 rounded-2xl mb-4 shadow-lg shadow-blue-500/20">
              <FileText className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">Control de Actas</h1>
            <p className="text-slate-400 text-sm mt-1">Ingresa tus credenciales</p>
          </div>
          <form onSubmit={handleLogin} className="p-8 space-y-6">
            {loginError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                <div className="w-1.5 h-1.5 bg-red-600 rounded-full" />
                {loginError}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Usuario</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  type="text" 
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-900"
                  placeholder="admin"
                  value={loginForm.user}
                  onChange={e => {
                    setLoginForm(prev => ({ ...prev, user: e.target.value }));
                    setLoginError(null);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Contraseña</label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  type={showPassword ? "text" : "password"} 
                  className="w-full pl-10 pr-12 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-900"
                  placeholder="••••"
                  value={loginForm.pass}
                  onChange={e => {
                    setLoginForm(prev => ({ ...prev, pass: e.target.value }));
                    setLoginError(null);
                  }}
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="pt-2">
              <button 
                type="submit"
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-600/20 active:scale-[0.98]"
              >
                Iniciar Sesión
              </button>
            </div>
            <div className="text-center space-y-4">
              <p className="text-xs text-slate-400">
                Prueba con <span className="font-mono font-bold text-slate-500">admin</span> / <span className="font-mono font-bold text-slate-500">1234</span>
              </p>
              <div className="pt-2 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={handleBypass}
                  className="text-xs text-blue-500 hover:text-blue-700 font-medium underline underline-offset-4"
                >
                  Entrar sin contraseña (Bypass)
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // --- Render App ---
  return (
    <div className={cn("min-h-screen flex", darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900")}>
      {/* Sidebar */}
      <aside className={cn(
        "w-64 border-r flex flex-col transition-colors",
        darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
      )}>
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <FileText className="text-white w-6 h-6" />
          </div>
          <span className="font-bold text-lg tracking-tight">ActasPro</span>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              activeTab === 'dashboard' 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
            )}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">Dashboard</span>
          </button>
          <button 
            onClick={() => setActiveTab('records')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              activeTab === 'records' 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
            )}
          >
            <Users className="w-5 h-5" />
            <span className="font-medium">Registros</span>
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              activeTab === 'stats' 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
            )}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="font-medium">Estadísticas</span>
          </button>
        </nav>

        <div className="p-4 border-t dark:border-slate-800 space-y-2">
          <div className="px-4 py-2 mb-2">
            {!hasApiKey ? (
              <div className="flex items-center gap-2 text-red-500 text-xs font-medium">
                <AlertCircle size={14} />
                <span>API Key Faltante</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-emerald-500 text-xs font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>IA Conectada</span>
              </div>
            )}
          </div>
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            <span className="font-medium">{darkMode ? 'Modo Claro' : 'Modo Oscuro'}</span>
          </button>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              {activeTab === 'dashboard' && 'Panel Principal'}
              {activeTab === 'records' && 'Gestión de Actas'}
              {activeTab === 'stats' && 'Análisis de Datos'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Bienvenido de nuevo, Administrador.
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors shadow-lg shadow-emerald-600/20"
            >
              <Download className="w-4 h-4" />
              Excel
            </button>
            <button 
              onClick={exportToPDF}
              className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-colors shadow-lg shadow-rose-600/20"
            >
              <FileDown className="w-4 h-4" />
              PDF
            </button>
          </div>
        </header>

        {/* Tab Content */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl">
                    <FileText className="w-6 h-6" />
                  </div>
                </div>
                <h3 className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total de Actas</h3>
                <p className="text-3xl font-bold mt-1">{records.length}</p>
              </div>
              <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-xl">
                    <Users className="w-6 h-6" />
                  </div>
                </div>
                <h3 className="text-slate-500 dark:text-slate-400 text-sm font-medium">Empleados Registrados</h3>
                <p className="text-3xl font-bold mt-1">{new Set(records.map(r => r.fullName)).size}</p>
              </div>
              <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-xl">
                    <Calendar className="w-6 h-6" />
                  </div>
                </div>
                <h3 className="text-slate-500 dark:text-slate-400 text-sm font-medium">Actas este Mes</h3>
                <p className="text-3xl font-bold mt-1">
                  {records.filter(r => r.date.startsWith(format(new Date(), 'yyyy-MM'))).length}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
                <h3 className="text-lg font-bold mb-6">Actas por Empleado (Top 10)</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statsData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? "#334155" : "#e2e8f0"} />
                      <XAxis dataKey="name" stroke={darkMode ? "#94a3b8" : "#64748b"} fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke={darkMode ? "#94a3b8" : "#64748b"} fontSize={12} tickLine={false} axisLine={false} />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: darkMode ? '#1e293b' : '#ffffff',
                          borderColor: darkMode ? '#334155' : '#e2e8f0',
                          borderRadius: '12px'
                        }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {statsData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
                <h3 className="text-lg font-bold mb-6">Últimos Registros</h3>
                <div className="space-y-4">
                  {records.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                          <User className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-semibold">{r.fullName}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{r.position}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{format(parseISO(r.date), 'dd MMM, yyyy')}</p>
                        <p className="text-xs text-slate-500">Registrado</p>
                      </div>
                    </div>
                  ))}
                  {records.length === 0 && (
                    <div className="text-center py-12 text-slate-500">No hay registros recientes.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="space-y-6">
            {/* Form Card */}
            <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              <h3 className="text-lg font-bold mb-6 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {editingId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                  {editingId ? 'Editar Acta' : 'Nueva Acta'}
                </div>
                {!editingId && (
                  <label className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all",
                    isExtracting 
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                      : "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100"
                  )}>
                    {isExtracting ? (
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 rotate-180" />
                    )}
                    {isExtracting ? 'Extrayendo...' : 'Cargar desde Imagen'}
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleExtractFromImage}
                      disabled={isExtracting}
                    />
                  </label>
                )}
              </h3>
              <form onSubmit={handleSaveRecord} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Nombre Completo</label>
                  <input 
                    type="text" 
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    value={formData.fullName}
                    onChange={e => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Puesto</label>
                  <input 
                    type="text" 
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    value={formData.position}
                    onChange={e => setFormData(prev => ({ ...prev, position: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Fecha del Acta</label>
                  <input 
                    type="date" 
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    value={formData.date}
                    onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-3 space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Motivo del Acta</label>
                  <textarea 
                    required
                    rows={3}
                    placeholder="Describe el motivo del acta..."
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white resize-none"
                    value={formData.reason}
                    onChange={e => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-3 flex justify-end gap-3">
                  {editingId && (
                    <button 
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setFormData({ fullName: '', position: '', date: format(new Date(), 'yyyy-MM-dd') });
                      }}
                      className="px-6 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Cancelar
                    </button>
                  )}
                  <button 
                    type="submit"
                    className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-600/20"
                  >
                    {editingId ? 'Actualizar Registro' : 'Guardar Acta'}
                  </button>
                </div>
              </form>
            </div>

            {/* Filters & Table */}
            <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              <div className="flex flex-col md:flex-row gap-4 justify-between mb-6">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input 
                    type="text" 
                    placeholder="Buscar por nombre o puesto..."
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 items-center">
                  <input 
                    type="date" 
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                    value={dateFilter.start}
                    onChange={e => setDateFilter(prev => ({ ...prev, start: e.target.value }))}
                  />
                  <span className="text-slate-400">a</span>
                  <input 
                    type="date" 
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm"
                    value={dateFilter.end}
                    onChange={e => setDateFilter(prev => ({ ...prev, end: e.target.value }))}
                  />
                  {(dateFilter.start || dateFilter.end) && (
                    <button 
                      onClick={() => setDateFilter({ start: '', end: '' })}
                      className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b dark:border-slate-800">
                      <th className="py-4 px-4 text-sm font-semibold text-slate-500">Nombre</th>
                      <th className="py-4 px-4 text-sm font-semibold text-slate-500">Puesto</th>
                      <th className="py-4 px-4 text-sm font-semibold text-slate-500">Motivo</th>
                      <th className="py-4 px-4 text-sm font-semibold text-slate-500">Fecha</th>
                      <th className="py-4 px-4 text-sm font-semibold text-slate-500 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-800">
                    {filteredRecords.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                              {r.fullName.charAt(0)}
                            </div>
                            <span className="font-medium">{r.fullName}</span>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-400">{r.position}</td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={r.reason}>
                          {r.reason}
                        </td>
                        <td className="py-4 px-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                            <Calendar className="w-3 h-3" />
                            {r.date}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => handleEdit(r)}
                              className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleDelete(r.id)}
                              className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredRecords.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-slate-500">
                          No se encontraron registros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-6">
            <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              <h3 className="text-lg font-bold mb-6">Resumen de Actas por Persona</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {statsData.map(item => (
                  <div key={item.name} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-xs text-slate-500">Empleado</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-blue-600">{item.count}</p>
                      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Actas</p>
                    </div>
                  </div>
                ))}
                {statsData.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-500">
                    Registra actas para ver las estadísticas.
                  </div>
                )}
              </div>
            </div>

            <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
              <h3 className="text-lg font-bold mb-6">Distribución Visual</h3>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={darkMode ? "#334155" : "#e2e8f0"} />
                    <XAxis type="number" stroke={darkMode ? "#94a3b8" : "#64748b"} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis dataKey="name" type="category" stroke={darkMode ? "#94a3b8" : "#64748b"} fontSize={12} tickLine={false} axisLine={false} width={150} />
                    <RechartsTooltip 
                      contentStyle={{ 
                        backgroundColor: darkMode ? '#1e293b' : '#ffffff',
                        borderColor: darkMode ? '#334155' : '#e2e8f0',
                        borderRadius: '12px'
                      }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
