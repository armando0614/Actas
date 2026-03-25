/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
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
  AlertCircle,
  Menu,
  X,
  Lock,
  Database,
  Upload
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
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signInAnonymously,
  onAuthStateChanged, 
  signOut, 
  FirebaseUser 
} from './firebase';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc, 
  doc, 
  updateDoc,
  getDocFromServer
} from 'firebase/firestore';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Ocurrió un error inesperado.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.operationType) {
          errorMessage = `Error de base de datos (${parsed.operationType}): ${parsed.error}`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">¡Ups! Algo salió mal</h2>
            <p className="text-slate-600 mb-8">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  createdBy: string;
  authorEmail?: string;
}

// --- Constants ---
const STORAGE_KEY = 'actas_records_v1';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '1234';

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  // --- State ---
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [records, setRecords] = useState<ActaRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'records' | 'stats'>('dashboard');
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('actaspro-theme');
      return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm?: () => void;
    type: 'alert' | 'confirm';
  }>({ isOpen: false, title: '', message: '', type: 'alert' });
  
  const showAlert = (title: string, message: string) => {
    setModal({ isOpen: true, title, message, type: 'alert' });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ isOpen: true, title, message, onConfirm, type: 'confirm' });
  };

  // Form State
  const [formData, setFormData] = useState({ fullName: '', position: '', reason: '', date: format(new Date(), 'yyyy-MM-dd') });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState({ current: 0, total: 0 });
  
  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [hasApiKey, setHasApiKey] = useState(false);

  // --- Computed Alerts ---
  const alerts = useMemo(() => {
    const personRecords: Record<string, ActaRecord[]> = {};
    records.forEach(r => {
      if (!personRecords[r.fullName]) personRecords[r.fullName] = [];
      personRecords[r.fullName].push(r);
    });

    const activeAlerts: { name: string; count: number; period: string; records: ActaRecord[] }[] = [];

    Object.entries(personRecords).forEach(([name, userRecords]) => {
      // Sort by date
      const sorted = [...userRecords].sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
      
      if (sorted.length >= 3) {
        for (let i = 0; i <= sorted.length - 3; i++) {
          const first = parseISO(sorted[i].date);
          const third = parseISO(sorted[i + 2].date);
          
          // Calculate working days (Mon-Fri)
          let workingDays = 0;
          let tempDate = new Date(first.getTime());
          while (tempDate <= third) {
            const day = tempDate.getDay();
            if (day !== 0 && day !== 6) workingDays++;
            tempDate.setDate(tempDate.getDate() + 1);
          }

          if (workingDays <= 30) {
            activeAlerts.push({
              name,
              count: sorted.length,
              period: `${format(first, 'dd/MM/yyyy')} - ${format(third, 'dd/MM/yyyy')}`,
              records: sorted.slice(i, i + 3)
            });
            break; // One alert per person is enough
          }
        }
      }
    });

    return activeAlerts;
  }, [records]);

  // --- Effects ---
  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('actaspro-theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('actaspro-theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });

    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setRecords([]);
      return;
    }

    const q = query(collection(db, 'records'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedRecords = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActaRecord[];
      setRecords(fetchedRecords);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'records');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const key = (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    const isValid = !!key && key !== 'MY_GEMINI_API_KEY';
    console.log("API Key detected:", isValid ? "YES" : "NO");
    setHasApiKey(isValid);
  }, []);

  // --- Handlers ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginForm.username === ADMIN_USER && loginForm.password === ADMIN_PASS) {
      handleBypass();
    } else {
      showAlert("Credenciales Incorrectas", "El usuario o la contraseña son incorrectos.");
    }
  };

  const handleBypass = async () => {
    try {
      // Try to sign in with Firebase
      await signInAnonymously(auth);
    } catch (error) {
      console.warn("Firebase Auth failed, using local session fallback:", error);
      // Fallback: Set a local user state so the app opens anyway
      setUser({ 
        uid: 'admin-local', 
        email: 'admin@actaspro.cloud',
        displayName: 'Administrador (Local)'
      } as any);
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setLoginForm({ username: '', password: '' });
    } catch (error) {
      console.error("Logout Error:", error);
      setUser(null);
    }
  };

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.position || !formData.date) return;

    // Check for duplicates before saving
    const isDuplicate = records.some(r => 
      r.fullName.trim().toLowerCase() === formData.fullName.trim().toLowerCase() &&
      r.position.trim().toLowerCase() === formData.position.trim().toLowerCase() &&
      r.reason.trim().toLowerCase() === formData.reason.trim().toLowerCase() &&
      r.date === formData.date &&
      r.id !== editingId
    );

    if (isDuplicate) {
      showAlert("Registro Duplicado", "Este registro ya existe (mismo nombre, puesto, motivo y fecha).");
      return;
    }

    try {
      if (editingId) {
        const docRef = doc(db, 'records', editingId);
        await updateDoc(docRef, { ...formData });
        setEditingId(null);
      } else {
        await addDoc(collection(db, 'records'), {
          ...formData,
          createdAt: Date.now(),
          createdBy: user?.uid,
          authorEmail: user?.email || 'Administrador'
        });
      }
      setFormData({ fullName: '', position: '', reason: '', date: format(new Date(), 'yyyy-MM-dd') });
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'records');
    }
  };

  const removeDuplicates = async () => {
    const seen = new Set();
    const duplicates: string[] = [];
    
    records.forEach(r => {
      const key = `${r.fullName.trim().toLowerCase()}|${r.position.trim().toLowerCase()}|${r.reason.trim().toLowerCase()}|${r.date}`;
      if (seen.has(key)) {
        duplicates.push(r.id);
      } else {
        seen.add(key);
      }
    });

    if (duplicates.length > 0) {
      showConfirm(
        "Registros Duplicados",
        `Se encontraron ${duplicates.length} registros duplicados. ¿Deseas eliminarlos de la base de datos?`,
        async () => {
          try {
            for (const id of duplicates) {
              await deleteDoc(doc(db, 'records', id));
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, 'records');
          }
        }
      );
    } else {
      showAlert("Limpieza", "No se encontraron registros duplicados.");
    }
  };

  const handleDelete = async (id: string) => {
    showConfirm(
      "Eliminar Registro",
      "¿Estás seguro de eliminar este registro?",
      async () => {
        try {
          await deleteDoc(doc(db, 'records', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'records');
        }
      }
    );
  };

  const exportData = () => {
    const dataStr = JSON.stringify(records, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `actaspro_backup_${format(new Date(), 'yyyyMMdd')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedRecords = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedRecords)) throw new Error("Formato de archivo inválido.");

        let count = 0;
        for (const record of importedRecords) {
          // Basic duplicate check
          const isDuplicate = records.some(r => 
            r.fullName.trim().toLowerCase() === record.fullName.trim().toLowerCase() &&
            r.position.trim().toLowerCase() === record.position.trim().toLowerCase() &&
            r.date === record.date
          );

          if (!isDuplicate) {
            await addDoc(collection(db, 'records'), {
              ...record,
              createdAt: Date.now(),
              createdBy: user?.uid,
              authorEmail: user?.email || 'Administrador'
            });
            count++;
          }
        }
        showAlert("Éxito", `Se importaron ${count} registros correctamente.`);
      } catch (error) {
        console.error("Error importing data:", error);
        showAlert("Error", "No se pudo importar el archivo. Asegúrate de que sea un JSON válido.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleEdit = (record: ActaRecord) => {
    setFormData({ fullName: record.fullName, position: record.position, reason: record.reason || '', date: record.date });
    setEditingId(record.id);
    setActiveTab('records');
  };

  const handleExtractFromImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsExtracting(true);
    setExtractionProgress({ current: 0, total: files.length });

    const apiKey = 
      (import.meta as any).env?.VITE_GEMINI_API_KEY || 
      process.env.GEMINI_API_KEY || 
      '';
      
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      setIsExtracting(false);
      console.error("GEMINI_API_KEY is missing or is the placeholder.");
      showAlert("Error de Configuración", "La clave de API de Gemini no está configurada correctamente. Por favor, asegúrate de haberla añadido en la sección de Secretos (⚙️ -> Secrets) con el nombre GEMINI_API_KEY.");
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setExtractionProgress({ current: i + 1, total: files.length });

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
        
        if (files.length > 1) {
          if (result.fullName || result.position || result.date || result.reason) {
            // Check for duplicates before saving
            const isDuplicate = records.some(r => 
              r.fullName.trim().toLowerCase() === (result.fullName || '').trim().toLowerCase() &&
              r.position.trim().toLowerCase() === (result.position || '').trim().toLowerCase() &&
              r.reason.trim().toLowerCase() === (result.reason || '').trim().toLowerCase() &&
              r.date === (result.date || '')
            );

            if (!isDuplicate) {
              await addDoc(collection(db, 'records'), {
                fullName: result.fullName || '',
                position: result.position || '',
                reason: result.reason || '',
                date: result.date || format(new Date(), 'yyyy-MM-dd'),
                createdAt: Date.now(),
                createdBy: user?.uid,
                authorEmail: user?.email || 'Administrador'
              });
              successCount++;
            } else {
              console.warn(`Duplicate record skipped: ${result.fullName}`);
            }
          }
        } else {
          if (result.fullName || result.position || result.date || result.reason) {
            setFormData({
              fullName: result.fullName || '',
              position: result.position || '',
              reason: result.reason || '',
              date: result.date || format(new Date(), 'yyyy-MM-dd'),
            });
            successCount++;
          }
        }
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        errorCount++;
      }
    }

    setIsExtracting(false);
    e.target.value = '';
    if (files.length > 1) {
      showAlert(
        "Procesamiento Finalizado", 
        `Se procesaron ${files.length} imágenes.\n- Exitosos: ${successCount}\n- Errores: ${errorCount}`
      );
    } else if (errorCount > 0) {
      showAlert("Error", "No se pudo extraer la información de la imagen.");
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
  const exportToExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      
      const fillSheetWithData = (worksheet: ExcelJS.Worksheet, dataRecords: ActaRecord[], sheetTitle: string) => {
        // 1. Header Section
        worksheet.mergeCells('A1:D1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'RESUMEN DE ACTAS ADMINISTRATIVAS';
        titleCell.font = { name: 'Arial', size: 12, color: { argb: 'FFFFFFFF' }, bold: true };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E4E79' } }; // Dark Blue from image
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(1).height = 25;

        worksheet.mergeCells('A2:B2');
        const dateCell = worksheet.getCell('A2');
        dateCell.value = `REPORTE GENERADO EL: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`;
        dateCell.font = { name: 'Arial', size: 10, bold: true };
        dateCell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(2).height = 20;

        // 2. Table Headers
        const headerRow = worksheet.getRow(4);
        headerRow.values = ['NOMBRE COMPLETO', 'PUESTO', 'MOTIVO DEL ACTA', 'FECHA'];
        headerRow.height = 40;
        headerRow.eachCell((cell) => {
          cell.font = { name: 'Arial', size: 10, bold: true };
          cell.border = { 
            top: { style: 'thin' }, 
            left: { style: 'thin' }, 
            bottom: { style: 'thin' }, 
            right: { style: 'thin' } 
          };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });

        // 3. Data Rows
        let currentRow = 5;
        const sorted = [...dataRecords].sort((a, b) => a.fullName.localeCompare(b.fullName));
        
        sorted.forEach((r) => {
          const row = worksheet.getRow(currentRow);
          row.values = [r.fullName, r.position, r.reason, r.date];
          row.height = 60; // Approximate height from image
          row.eachCell((cell) => {
            cell.font = { name: 'Arial', size: 9 };
            cell.border = { 
              top: { style: 'thin' }, 
              left: { style: 'thin' }, 
              bottom: { style: 'thin' }, 
              right: { style: 'thin' } 
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          });
          currentRow++;
        });

        // 4. Summary Table (Only on first sheet or if requested)
        currentRow += 2;
        const summaryStart = currentRow;
        
        worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
        const summaryHeader = worksheet.getCell(`A${currentRow}`);
        summaryHeader.value = 'RESUMEN GENERAL';
        summaryHeader.font = { name: 'Arial', size: 10, bold: true };
        summaryHeader.alignment = { vertical: 'middle', horizontal: 'center' };
        summaryHeader.border = { 
          top: { style: 'thin' }, 
          left: { style: 'thin' }, 
          bottom: { style: 'thin' }, 
          right: { style: 'thin' } 
        };
        worksheet.getCell(`D${currentRow}`).border = { 
          top: { style: 'thin' }, 
          left: { style: 'thin' }, 
          bottom: { style: 'thin' }, 
          right: { style: 'thin' } 
        };
        currentRow++;

        const createSummaryRow = (label: string, value: number) => {
          worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
          const labelCell = worksheet.getCell(`A${currentRow}`);
          labelCell.value = label;
          labelCell.font = { name: 'Arial', size: 10 };
          labelCell.border = { 
            top: { style: 'thin' }, 
            left: { style: 'thin' }, 
            bottom: { style: 'thin' }, 
            right: { style: 'thin' } 
          };
          
          const valueCell = worksheet.getCell(`D${currentRow}`);
          valueCell.value = value;
          valueCell.font = { name: 'Arial', size: 10 };
          valueCell.alignment = { horizontal: 'center' };
          valueCell.border = { 
            top: { style: 'thin' }, 
            left: { style: 'thin' }, 
            bottom: { style: 'thin' }, 
            right: { style: 'thin' } 
          };
          currentRow++;
        };

        createSummaryRow('Total de Actas Registradas:', sorted.length);
        createSummaryRow('Total de Personas con Actas:', new Set(sorted.map(r => r.fullName)).size);

        // Column Widths
        worksheet.getColumn(1).width = 30;
        worksheet.getColumn(2).width = 25;
        worksheet.getColumn(3).width = 70;
        worksheet.getColumn(4).width = 12;
      };

      // Sheet 1: General
      const sheet1 = workbook.addWorksheet('Reporte General');
      fillSheetWithData(sheet1, filteredRecords, 'General');

      // Sheet 2: Reincidentes (3+)
      // Calculate who has 3 or more records total
      const counts: Record<string, number> = {};
      records.forEach(r => counts[r.fullName] = (counts[r.fullName] || 0) + 1);
      const reincidentNames = Object.keys(counts).filter(name => counts[name] >= 3);
      const reincidentRecords = filteredRecords.filter(r => reincidentNames.includes(r.fullName));

      if (reincidentRecords.length > 0) {
        const sheet2 = workbook.addWorksheet('Personas con 3+ Actas');
        fillSheetWithData(sheet2, reincidentRecords, 'Reincidentes');
      }

      // Generate and Save
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Reporte_Actas_Final_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    } catch (error) {
      console.error("Error generating Excel:", error);
      showAlert("Error", "Error al generar el Excel. Por favor intenta de nuevo.");
    }
  };

  const exportToPDF = () => {
    try {
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(18);
      doc.setTextColor(40, 40, 40);
      doc.text("Resumen de Actas Administrativas", 14, 22);
      
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Generado por: Sistema ActasPro`, 14, 28);
      doc.text(`Fecha: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 33);
      
      // Table
      (doc as any).autoTable({
        startY: 40,
        head: [['Nombre', 'Puesto', 'Motivo', 'Fecha']],
        body: filteredRecords.map(r => [r.fullName, r.position, r.reason, r.date]),
        headStyles: { 
          fillColor: [37, 99, 235], 
          textColor: 255, 
          fontSize: 10, 
          fontStyle: 'bold',
          halign: 'center'
        },
        bodyStyles: { 
          fontSize: 9,
          textColor: 50
        },
        alternateRowStyles: { 
          fillColor: [248, 250, 252] 
        },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 35 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 25, halign: 'center' }
        },
        margin: { top: 40 },
        didDrawPage: (data: any) => {
          // Footer
          const str = "Página " + doc.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(str, data.settings.margin.left, doc.internal.pageSize.height - 10);
        }
      });
      
      doc.save(`Resumen_Actas_${format(new Date(), 'yyyyMMdd')}.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
      showAlert("Error", "Error al generar el PDF. Por favor intenta de nuevo.");
    }
  };

  // --- Render Login ---
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen flex flex-col md:flex-row", darkMode ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900")}>
      <AnimatePresence mode="wait">
        {!user ? (
          <motion.div 
            key="login"
            initial={{ opacity: 0, scale: 0.9, rotateY: -20 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            exit={{ opacity: 0, scale: 1.1, rotateY: 20, filter: "blur(10px)" }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className={cn("fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden transition-colors duration-500", darkMode ? "bg-slate-950" : "bg-slate-100")}
          >
            {/* Theme Toggle for Login Screen */}
            <div className="absolute top-8 right-8">
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setDarkMode(!darkMode)}
                className={cn(
                  "p-3 rounded-2xl shadow-lg transition-all",
                  darkMode ? "bg-slate-900 text-yellow-400 border border-slate-800" : "bg-white text-slate-600 border border-slate-200"
                )}
              >
                {darkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
              </motion.button>
            </div>

            <motion.div 
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className={cn(
                "w-full max-w-md rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border overflow-hidden relative transition-colors duration-300",
                darkMode ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"
              )}
              style={{ perspective: 1000 }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-purple-600/10 pointer-events-none" />
              
              <div className="bg-slate-900 p-8 text-center relative">
                <motion.div 
                  animate={{ rotateY: [0, 360] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="inline-flex items-center justify-center w-16 h-16 bg-blue-500 rounded-2xl mb-4 shadow-[0_0_30px_rgba(59,130,246,0.5)]"
                >
                  <FileText className="text-white w-8 h-8" />
                </motion.div>
                <h1 className="text-2xl font-bold text-white tracking-tight">ActasPro Cloud</h1>
                <p className="text-slate-400 text-xs mt-1">Gestión de Actas Administrativas</p>
              </div>

              <form onSubmit={handleLogin} className="p-8 space-y-5">
                <div className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input 
                      type="text"
                      placeholder="Usuario"
                      required
                      value={loginForm.username}
                      onChange={e => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                      className={cn(
                        "w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all",
                        darkMode ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" : "bg-slate-50 border-slate-200 text-slate-900"
                      )}
                    />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input 
                      type="password"
                      placeholder="Contraseña"
                      required
                      value={loginForm.password}
                      onChange={e => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                      className={cn(
                        "w-full pl-11 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all",
                        darkMode ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" : "bg-slate-50 border-slate-200 text-slate-900"
                      )}
                    />
                  </div>
                </div>
                
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
                >
                  Acceder al Sistema
                </motion.button>

                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleBypass}
                  className={cn(
                    "w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 border",
                    darkMode ? "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700" : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200"
                  )}
                >
                  Acceso Directo (Bypass)
                </motion.button>

                <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 pt-2">
                  <div className={cn("w-8 h-px", darkMode ? "bg-slate-800" : "bg-slate-200")} />
                  <span>Sincronización en Tiempo Real</span>
                  <div className={cn("w-8 h-px", darkMode ? "bg-slate-800" : "bg-slate-200")} />
                </div>
              </form>
            </motion.div>

            {/* Decorative elements */}
            <div className="fixed -top-20 -left-20 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
            <div className="fixed -bottom-20 -right-20 w-64 h-64 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />
          </motion.div>
        ) : (
          <motion.div 
            key="app"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col md:flex-row w-full min-h-screen"
          >
            {/* Mobile Header */}
            <div className={cn(
              "md:hidden flex items-center justify-between p-4 border-b transition-colors sticky top-0 z-50 w-full",
              darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
            )}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <FileText className="text-white w-5 h-5" />
                </div>
                <span className="font-bold text-lg">ActasPro</span>
              </div>
              <button 
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 border-r flex flex-col transition-all duration-300 transform md:relative md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
      )}>
        <div className="p-6 flex items-center justify-between md:justify-start gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <FileText className="text-white w-6 h-6" />
            </div>
            <span className="font-bold text-lg tracking-tight">ActasPro</span>
          </div>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => { setActiveTab('dashboard'); setSidebarOpen(false); }}
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
            onClick={() => { setActiveTab('records'); setSidebarOpen(false); }}
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
            onClick={() => { setActiveTab('stats'); setSidebarOpen(false); }}
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
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl mb-3">
            <img 
              src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName}`} 
              alt="Avatar" 
              className="w-10 h-10 rounded-full border-2 border-white dark:border-slate-700"
              referrerPolicy="no-referrer"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{user?.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
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
          <div className="pt-2 border-t dark:border-slate-800 space-y-2">
            <button 
              onClick={exportData}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all"
            >
              <Database className="w-5 h-5" />
              <span className="font-medium">Descargar Backup</span>
            </button>
            <label className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all cursor-pointer">
              <Upload className="w-5 h-5" />
              <span className="font-medium">Cargar Backup</span>
              <input type="file" accept=".json" className="hidden" onChange={importData} />
            </label>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {activeTab === 'dashboard' && 'Panel Principal'}
              {activeTab === 'records' && 'Gestión de Actas'}
              {activeTab === 'stats' && 'Análisis de Datos'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Bienvenido de nuevo, Administrador.
            </p>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button 
              onClick={exportToExcel}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors shadow-lg shadow-emerald-600/20"
            >
              <Download className="w-4 h-4" />
              Excel
            </button>
            <button 
              onClick={exportToPDF}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-colors shadow-lg shadow-rose-600/20"
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
              {/* Alerts Section */}
              <div className={cn("p-6 rounded-2xl border shadow-sm", darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200")}>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <AlertCircle className="text-rose-500 w-5 h-5" />
                    Alertas de Reincidencia
                  </h3>
                  <span className="px-2 py-1 bg-rose-100 dark:bg-rose-900/30 text-rose-600 text-xs font-bold rounded-lg">
                    {alerts.length} Críticas
                  </span>
                </div>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {alerts.map((alert, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/30">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-rose-700 dark:text-rose-400">{alert.name}</p>
                          <p className="text-xs text-rose-600/70 dark:text-rose-400/60">3+ actas en menos de 30 días hábiles</p>
                        </div>
                        <div className="bg-rose-600 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase">
                          Alerta
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 font-medium">
                        <Calendar className="w-3 h-3" />
                        Periodo: {alert.period}
                      </div>
                    </div>
                  ))}
                  {alerts.length === 0 && (
                    <div className="text-center py-12 text-slate-400 italic text-sm">
                      No se detectaron reincidencias críticas.
                    </div>
                  )}
                </div>
              </div>

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
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs">
                          {extractionProgress.total > 1 
                            ? `${extractionProgress.current}/${extractionProgress.total}` 
                            : 'Extrayendo...'}
                        </span>
                      </div>
                    ) : (
                      <Download className="w-4 h-4 rotate-180" />
                    )}
                    {isExtracting ? '' : 'Cargar desde Imagen'}
                    <input 
                      type="file" 
                      accept="image/*" 
                      multiple
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
                        setFormData({ fullName: '', position: '', reason: '', date: format(new Date(), 'yyyy-MM-dd') });
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
                  <button 
                    onClick={removeDuplicates}
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-colors text-sm font-medium"
                    title="Eliminar registros idénticos"
                  >
                    <Trash2 className="w-4 h-4" />
                    Limpiar Duplicados
                  </button>
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

      {/* Custom Modal */}
      <AnimatePresence>
        {modal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={cn(
                "relative w-full max-w-md rounded-2xl shadow-2xl p-6 overflow-hidden",
                darkMode ? "bg-slate-900 border border-slate-800" : "bg-white"
              )}
            >
              <div className="flex items-start gap-4 mb-6">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0",
                  modal.type === 'confirm' ? "bg-blue-100 text-blue-600" : "bg-amber-100 text-amber-600"
                )}>
                  {modal.type === 'confirm' ? <AlertCircle className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                </div>
                <div>
                  <h3 className={cn("text-lg font-bold mb-1", darkMode ? "text-white" : "text-slate-900")}>
                    {modal.title}
                  </h3>
                  <p className={cn("text-sm", darkMode ? "text-slate-400" : "text-slate-600")}>
                    {modal.message}
                  </p>
                </div>
              </div>
              
              <div className="flex justify-end gap-3">
                {modal.type === 'confirm' && (
                  <button 
                    onClick={() => setModal(prev => ({ ...prev, isOpen: false }))}
                    className={cn(
                      "px-4 py-2 rounded-xl font-medium transition-colors",
                      darkMode ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-600"
                    )}
                  >
                    Cancelar
                  </button>
                )}
                <button 
                  onClick={() => {
                    if (modal.onConfirm) modal.onConfirm();
                    setModal(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-600/20"
                >
                  {modal.type === 'confirm' ? 'Confirmar' : 'Entendido'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
