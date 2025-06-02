
"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CalculatorIcon, ListOrdered, Edit3, Save, RotateCcw, HistoryIcon, Printer } from "lucide-react";
import type { BoppCalculatorInputs, BoppCalculationResult, BoppRate, PrintTypeRateKey, PasteTypeRateKey } from "@/lib/types";
import { printTypeRateKeys, pasteTypeRateKeys } from "@/lib/types";
import { calculateBoppTapeCost, getMaterialRates, updateMaterialRatesAction } from "@/lib/actions/bopp_rates_actions";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";

const calculatorSchema = z.object({
  boppFilmThickness: z.coerce.number().positive("BOPP film thickness must be positive"),
  adhesiveThickness: z.coerce.number().positive("Adhesive thickness must be positive"),
  tapeLength: z.coerce.number().positive("Tape length must be positive"),
  metersForCorelessCalc: z.coerce.number().positive("Total Meters (for Batch Calc) must be positive"),
  printType: z.enum(printTypeRateKeys, {
    errorMap: () => ({ message: "Please select a valid print type." }),
  }),
  pasteType: z.enum(pasteTypeRateKeys, {
    errorMap: () => ({ message: "Please select a valid tape/paste type." })
  }),
});

type CalculatorFormValues = z.infer<typeof calculatorSchema>;

const materialRateSchema = z.object({
  key: z.string(),
  value: z.coerce.number().nonnegative("Rate must be non-negative"),
});

const materialRatesSchema = z.object({
  rates: z.array(materialRateSchema),
});

type MaterialRatesFormValues = z.infer<typeof materialRatesSchema>;

interface RateChangeSummary {
  key: string;
  oldValue: number;
  newValue: number;
}

const formatValue = (value: number | null | undefined, decimals: number = 2): string => {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
        return 'N/A';
    }
    if (decimals === 0) {
        return value.toFixed(0);
    }
    return value.toFixed(decimals);
  }
  return String(value);
};

const printTypeOptions: { key: PrintTypeRateKey; label: string }[] = [
  { key: "natural", label: "Natural" },
  { key: "single_colour_printed", label: "Single Colour Printed" },
  { key: "double_colour_printed", label: "Double Colour Printed" },
  { key: "three_colour_printed", label: "Three Colour Printed" },
  { key: "four_colour_printed", label: "Four Colour Printed" },
  { key: "full_print", label: "Full Print" },
];

const pasteTypeOptions: { key: PasteTypeRateKey; label: string }[] = [
    { key: "transparent", label: "Transparent Tape" },
    { key: "milky_white", label: "Milky White Tape" },
    { key: "brown_tape", label: "Brown Tape" },
    { key: "color_tape", label: "Color Tape" },
];

const rateCategories = [
  {
    title: "Print Type Rates",
    keys: printTypeRateKeys,
  },
  {
    title: "Tape/Paste Type Rates",
    keys: pasteTypeRateKeys,
  },
  {
    title: "Base Material Rates",
    keys: ["bopp_film_rate", "adhesive_rate"],
  },
  {
    title: "Process & Overhead Rates",
    keys: ["adhesive_less_rate", "coating_exp", "packing_cost", "profit"],
  },
];

export default function BoppCalculatorPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [calculationResult, setCalculationResult] = useState<BoppCalculationResult | null>(null);
  const [lastInputs, setLastInputs] = useState<BoppCalculatorInputs | null>(null);
  const [currentRates, setCurrentRates] = useState<BoppRate[]>([]);
  const [initialRates, setInitialRates] = useState<BoppRate[]>([]); 
  const [activeTab, setActiveTab] = useState("calculator");
  const [isRatesLoading, setIsRatesLoading] = useState(user?.role === 'admin');
  const [changeSummary, setChangeSummary] = useState<RateChangeSummary[]>([]);

  const calculatorForm = useForm<CalculatorFormValues>({
    resolver: zodResolver(calculatorSchema),
    defaultValues: {
      boppFilmThickness: '' as any,
      adhesiveThickness: '' as any,
      tapeLength: '' as any,
      metersForCorelessCalc: '' as any,
      printType: undefined,
      pasteType: undefined,
    },
  });

  const materialRatesForm = useForm<MaterialRatesFormValues>({
    resolver: zodResolver(materialRatesSchema),
    defaultValues: { rates: [] },
  });

  useEffect(() => {
    fetchRates();
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const sortedRates = [];
    const rateMap = new Map(currentRates.map(rate => [rate.key, rate]));
    const allCategorizedKeys = new Set<string>();

    rateCategories.forEach(category => {
      category.keys.forEach(key => {
        if (rateMap.has(key)) {
          sortedRates.push(rateMap.get(key)!);
          allCategorizedKeys.add(key);
        }
      });
    });
    currentRates.forEach(rate => {
      if (!allCategorizedKeys.has(rate.key)) {
        sortedRates.push(rate); 
      }
    });
    materialRatesForm.reset({ rates: sortedRates.map(r => ({key: r.key, value: Number(r.value) })) });
  }, [currentRates, materialRatesForm]);

  useEffect(() => {
    if (initialRates.length === 0) {
      setChangeSummary([]);
      return;
    }

    const subscription = materialRatesForm.watch((formValues, { name, type }) => {
      if ((name && name.startsWith('rates.')) || type === 'change') {
        const currentFormRatesArray = formValues.rates || [];
        const newSummary: RateChangeSummary[] = [];

        currentFormRatesArray.forEach(formRateEntry => {
          const matchingInitialRate = initialRates.find(ir => ir.key === formRateEntry.key);
          const currentVal = Number(formRateEntry.value);
          const initialVal = matchingInitialRate ? Number(matchingInitialRate.value) : undefined;

          if (matchingInitialRate && initialVal !== undefined && initialVal !== currentVal) {
            newSummary.push({
              key: formRateEntry.key,
              oldValue: initialVal,
              newValue: currentVal,
            });
          }
        });
        setChangeSummary(newSummary);
      }
    });
    return () => subscription.unsubscribe();
  }, [materialRatesForm, initialRates]);


  async function fetchRates() {
    if (user?.role === 'admin') setIsRatesLoading(true);
    const response = await getMaterialRates();
    if (response.success && response.rates) {
      setCurrentRates(response.rates);
      if (user?.role === 'admin') {
        setInitialRates(JSON.parse(JSON.stringify(response.rates)));
      }
    } else {
      toast({ title: "Error", description: response.error || "Failed to fetch material rates.", variant: "destructive" });
    }
    if (user?.role === 'admin') setIsRatesLoading(false);
  }

  const handleCalculate = async (data: CalculatorFormValues) => {
    setIsLoading(true);
    setCalculationResult(null);
    const inputsForAction: BoppCalculatorInputs = {
        ...data,
    };
    const response = await calculateBoppTapeCost(inputsForAction);
    if (response.success && response.result) {
      setCalculationResult(response.result);
      setLastInputs(inputsForAction);
      toast({ title: "Calculation Successful", description: `Cost per piece (R2): ${formatValue(response.result.R2)}` });
      setActiveTab("results");
    } else {
      toast({ title: "Calculation Failed", description: response.error, variant: "destructive" });
    }
    setIsLoading(false);
  };

  const handleSaveChanges = async (data: MaterialRatesFormValues) => {
    if (!user || user.role !== 'admin') return;
    setIsLoading(true);
    const ratesToUpdate: BoppRate[] = data.rates.map(formRate => {
      const originalRate = initialRates.find(r => r.key === formRate.key);
      return {
        id: originalRate?.id,
        key: formRate.key,
        value: formRate.value, 
      };
    });

    const response = await updateMaterialRatesAction(ratesToUpdate, user.id, user.name);
    if (response.success) {
      toast({ title: "Success", description: response.message });
      fetchRates(); 
      setChangeSummary([]); 
    } else {
      toast({ title: "Error", description: response.error, variant: "destructive" });
    }
    setIsLoading(false);
  };

  const handleResetRates = () => {
    const sortedInitialRates = [];
    const initialRateMap = new Map(initialRates.map(rate => [rate.key, rate]));
    const allCategorizedKeys = new Set<string>();

    rateCategories.forEach(category => {
        category.keys.forEach(key => {
            if (initialRateMap.has(key)) {
                sortedInitialRates.push(initialRateMap.get(key)!);
                allCategorizedKeys.add(key);
            }
        });
    });
    initialRates.forEach(rate => {
        if (!allCategorizedKeys.has(rate.key)) {
            sortedInitialRates.push(rate);
        }
    });
    materialRatesForm.reset({ rates: sortedInitialRates.map(r => ({key: r.key, value: Number(r.value) })) });
    setChangeSummary([]); 
    toast({ title: "Rates Reset", description: "Changes have been reverted to last saved state." });
  };

  const getRateCardQueryString = () => {
    if (!lastInputs || !calculationResult) return "";
    const params = new URLSearchParams();
    
    Object.entries(lastInputs).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            if (key === 'printType' || key === 'pasteType') {
                const selectedPrintOption = printTypeOptions.find(o => o.key === lastInputs.printType);
                const selectedPasteOption = pasteTypeOptions.find(o => o.key === lastInputs.pasteType);
                if (key === 'printType') params.append(key, selectedPrintOption ? selectedPrintOption.label : String(value));
                if (key === 'pasteType') params.append(key, selectedPasteOption ? selectedPasteOption.label : String(value));
            } else {
                 params.append(key, String(value));
            }
        }
    });
    
    Object.entries(calculationResult).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          if (key === 'bopp_tape_mtrs' && calculationResult.bopp_tape_mtrs !== undefined) {
              params.append(key, String(calculationResult.bopp_tape_mtrs));
          } else if (key !== 'bopp_tape_mtrs') { 
              params.append(key, String(value));
          }
        }
    });
    if (lastInputs.tapeLength && !params.has('bopp_tape_mtrs')) {
        params.append('bopp_tape_mtrs', String(lastInputs.tapeLength));
    }


    return params.toString();
  };

  const formRates = materialRatesForm.watch('rates');
  const hasChanges = JSON.stringify(formRates.map(r => ({key: r.key, value: parseFloat(r.value.toString()) }))) !== JSON.stringify(initialRates.map(r => ({key: r.key, value: parseFloat(r.value.toString())})));


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <h1 className="text-3xl font-bold text-primary mb-6">BOPP Tape Calculator</h1>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="inline-flex overflow-x-auto hide-scrollbar h-10 items-center rounded-md bg-muted p-1 text-muted-foreground">
          <TabsTrigger value="calculator" className="flex-shrink-0 whitespace-nowrap"><CalculatorIcon className="mr-2 h-4 w-4" />Calculator</TabsTrigger>
          <TabsTrigger value="results" disabled={!calculationResult} className="flex-shrink-0 whitespace-nowrap"><ListOrdered className="mr-2 h-4 w-4" />Results</TabsTrigger>
          {user?.role === "admin" && <TabsTrigger value="material-rates" className="flex-shrink-0 whitespace-nowrap"><Edit3 className="mr-2 h-4 w-4" />Material Rates</TabsTrigger>}
        </TabsList>

        <TabsContent value="calculator">
          <Card>
            <CardHeader>
              <CardTitle>Enter Parameters</CardTitle>
              <CardDescription>Provide the specifications for the BOPP tape.</CardDescription>
            </CardHeader>
            <Form {...calculatorForm}>
              <form onSubmit={calculatorForm.handleSubmit(handleCalculate)}>
                <CardContent className="space-y-4 grid md:grid-cols-2 gap-6">
                  <FormField control={calculatorForm.control} name="boppFilmThickness" render={({ field }) => (
                    <FormItem><FormLabel>BOPP Film Thickness (µm)</FormLabel><FormControl><Input type="number" placeholder="Enter thickness" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={calculatorForm.control} name="adhesiveThickness" render={({ field }) => (
                    <FormItem><FormLabel>Adhesive Thickness (µm)</FormLabel><FormControl><Input type="number" placeholder="Enter thickness" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={calculatorForm.control} name="tapeLength" render={({ field }) => (
                    <FormItem><FormLabel>BOPP Tape Length (meters)</FormLabel><FormControl><Input type="number" placeholder="Enter length per roll" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                   <FormField control={calculatorForm.control} name="metersForCorelessCalc" render={({ field }) => (
                    <FormItem><FormLabel>Total Meters (for Batch Calc)</FormLabel><FormControl><Input type="number" placeholder="e.g., 1000" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField
                    control={calculatorForm.control}
                    name="printType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Print Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select print type" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {printTypeOptions.map(option => (
                              <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField control={calculatorForm.control} name="pasteType" render={({ field }) => (
                    <FormItem><FormLabel>Tape / Paste Additive Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select tape/paste type" /></SelectTrigger></FormControl><SelectContent>
                        {pasteTypeOptions.map(option => (
                            <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                        ))}
                    </SelectContent></Select><FormMessage /></FormItem>
                  )} />
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full md:w-auto" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Calculate Cost"}
                  </Button>
                </CardFooter>
              </form>
            </Form>
          </Card>
        </TabsContent>

        <TabsContent value="results">
          {!calculationResult ? (
             <Card><CardContent><p className="py-8 text-center text-muted-foreground">No results to display. Please perform a calculation first.</p></CardContent></Card>
          ) : (
            <div className="bg-background font-sans">
              <div className="max-w-7xl mx-auto">
                <div className="bg-card rounded-xl shadow-lg overflow-hidden mb-8 border">
                  <div className="bg-gradient-to-r from-primary to-indigo-900 px-4 sm:px-6 py-4 sm:py-5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-primary-foreground">Key Manufacturing Results</h2>
                        <p className="text-primary-foreground/80 text-xs sm:text-sm mt-1">Primary calculation outputs for BOPP tape manufacturing</p>
                      </div>
                      <div className="hidden sm:block">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Production Active
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 sm:px-6 py-5 bg-gradient-to-b from-muted/30 to-card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                      <div className="bg-card rounded-lg border shadow-sm overflow-hidden hover:shadow transition-shadow duration-200">
                        <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-muted/50 border-b">
                          <h3 className="text-xs sm:text-sm font-semibold text-foreground flex items-center">
                            <div className="w-1 h-3.5 sm:h-4 bg-primary mr-1.5 sm:mr-2 rounded"></div>
                            Manufacturing Rates
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y">
                            <thead className="bg-muted/30">
                              <tr>
                                <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-medium text-muted-foreground tracking-wider">Parameter</th>
                                <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-right text-xs font-medium text-muted-foreground tracking-wider">Base Rate</th>
                                <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-right text-xs font-medium text-muted-foreground tracking-wider">Of MIC</th>
                              </tr>
                            </thead>
                            <tbody className="bg-card divide-y">
                              <tr>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">Microns</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R1)}</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R2)}</td>
                              </tr>
                              <tr>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">Jumbo Rate</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R3)}</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R4)}</td>
                              </tr>
                              <tr>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">288 MM Rate</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R5)}</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R6)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="bg-card rounded-lg border shadow-sm overflow-hidden hover:shadow transition-shadow duration-200">
                        <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-muted/50 border-b">
                          <h3 className="text-xs sm:text-sm font-semibold text-foreground flex items-center">
                            <div className="w-1 h-3.5 sm:h-4 bg-primary mr-1.5 sm:mr-2 rounded"></div>
                            Jumbo Roll Weights
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y text-left">
                            <thead className="bg-muted/30">
                              <tr>
                                <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-medium text-muted-foreground tracking-wider">Jumbo Wt 1315</th>
                                <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-medium text-muted-foreground tracking-wider">Jumbo Wt 1610</th>
                              </tr>
                            </thead>
                            <tbody className="bg-card divide-y">
                              <tr>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-muted-foreground">{formatValue(calculationResult.R7)}</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-muted-foreground">{formatValue(calculationResult.R8)}</td>
                              </tr>
                              <tr>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-muted-foreground">{formatValue(calculationResult.R9)}</td>
                                <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-muted-foreground">{formatValue(calculationResult.R10)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-card rounded-xl shadow-lg overflow-hidden mb-8 border">
                  <div className="bg-gradient-to-r from-primary to-indigo-900 px-4 sm:px-6 py-4 sm:py-5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-primary-foreground">Weight Calculations</h2>
                        <p className="text-primary-foreground/80 text-xs sm:text-sm mt-1">Production weight analytics</p>
                      </div>
                      <div className="hidden sm:block">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-200 text-primary">
                          Updated Hourly
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 sm:px-6 py-5">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y">
                        <thead className="bg-muted/30">
                          <tr>
                            <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-medium text-muted-foreground tracking-wider">Parameter</th>
                            <th scope="col" className="px-3 sm:px-4 py-2.5 sm:py-3 text-right text-xs font-medium text-muted-foreground tracking-wider">Value</th>
                          </tr>
                        </thead>
                        <tbody className="bg-card divide-y">
                          <tr>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">Scale Weight</td>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R11)}</td>
                          </tr>
                          <tr>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">Box Weight</td>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R12)}</td>
                          </tr>
                          <tr>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">Sq Mtrs Rate</td>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R13, 4)}</td>
                          </tr>
                          <tr>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-medium text-foreground">Per Pcs Wt (48mm)</td>
                            <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap text-xs sm:text-sm text-right text-muted-foreground">{formatValue(calculationResult.R14, 4)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="bg-card rounded-xl shadow-lg overflow-hidden mb-8 border">
                  <div className="bg-gradient-to-r from-primary to-indigo-900 px-4 sm:px-6 py-4 sm:py-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-primary-foreground">Size-Based Calculations</h2>
                        <p className="text-primary-foreground/80 text-xs sm:text-sm mt-1">
                          Microns: {formatValue(calculationResult.R1)} &bull; BOPP Mtrs: {formatValue(calculationResult.bopp_tape_mtrs, 0)}
                        </p>
                      </div>
                      <div className="mt-2 sm:mt-0">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-200 text-primary">
                          Rate per piece for different tape widths
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="px-4 sm:px-6 py-5 sm:py-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                      <div className="bg-card rounded-lg border shadow-sm overflow-hidden hover:shadow transition-shadow duration-200">
                        <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-muted/50 border-b">
                          <h3 className="text-xs sm:text-sm font-semibold text-foreground flex items-center">
                            <div className="w-1 h-3.5 sm:h-4 bg-primary mr-1.5 sm:mr-2 rounded"></div>
                            Standard Width Rates
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y">
                            <thead className="bg-muted/30">
                              <tr>
                                <th className="px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-medium text-muted-foreground tracking-wider">Size (mm)</th>
                                <th className="px-3 sm:px-4 py-2.5 sm:py-3 text-right text-xs font-medium text-muted-foreground tracking-wider">Value</th>
                              </tr>
                            </thead>
                            <tbody className="bg-card divide-y">
                              {[
                                { size: 12, key: 'R15' }, { size: 18, key: 'R16' },
                                { size: 24, key: 'R17' }, { size: 48, key: 'R18' },
                                { size: 60, key: 'R19' }, { size: 72, key: 'R20' },
                                { size: 96, key: 'R21' }
                              ].map(({ size, key }) => (
                                <tr key={size} className="hover:bg-muted/50">
                                  <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-foreground">{size}</td>
                                  <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm text-right text-muted-foreground">
                                    {formatValue((calculationResult as any)[key])}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="bg-card rounded-lg border shadow-sm overflow-hidden hover:shadow transition-shadow duration-200">
                        <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-muted/50 border-b">
                           <h3 className="text-xs sm:text-sm font-semibold text-foreground flex items-center">
                              <div className="w-1 h-3.5 sm:h-4 bg-primary mr-1.5 sm:mr-2 rounded"></div>
                               Additional Width Rates
                           </h3>
                          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 sm:mt-1">
                            Per {formatValue(calculationResult.R36, 0)} Meters &bull; Production Metrics
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y">
                            <thead className="bg-muted/30">
                              <tr>
                                <th className="px-3 sm:px-4 py-2.5 sm:py-3 text-left text-xs font-medium text-muted-foreground tracking-wider">Size (mm)</th>
                                <th className="px-3 sm:px-4 py-2.5 sm:py-3 text-right text-xs font-medium text-muted-foreground tracking-wider">Value</th>
                              </tr>
                            </thead>
                            <tbody className="bg-card divide-y">
                              {[
                                { size: 36, key: 'R25' },
                                { size: 48, key: 'R23' },
                                { size: 60, key: 'R26' },
                                { size: 72, key: 'R24' },
                              ].sort((a,b) => a.size - b.size)
                              .map(({ size, key }) => (
                                <tr key={size} className="hover:bg-muted/50">
                                  <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-foreground">{size}</td>
                                  <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm text-right text-muted-foreground">
                                    {formatValue((calculationResult as any)[key])}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                   <CardFooter className="pt-6 border-t">
                        <Link href={`/rate-card?${getRateCardQueryString()}`} passHref legacyBehavior>
                            <a target="_blank" rel="noopener noreferrer" className="ml-auto">
                                <Button variant="outline">
                                    <Printer className="mr-2 h-4 w-4" /> Generate Printable Rate Card
                                </Button>
                            </a>
                        </Link>
                    </CardFooter>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {user?.role === "admin" && (
          <TabsContent value="material-rates">
            <Card>
              <CardHeader>
                <CardTitle>Manage Material Rates</CardTitle>
                <CardDescription>Update the underlying rates used for calculations.</CardDescription>
              </CardHeader>
              {isRatesLoading ? <CardContent><div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div></CardContent> :
              <Form {...materialRatesForm}>
                <form onSubmit={materialRatesForm.handleSubmit(handleSaveChanges)}>
                  <CardContent className="space-y-6 max-h-[calc(100vh-300px)] overflow-y-auto">
                    {rateCategories.map((category) => (
                      <div key={category.title} className="space-y-4">
                        <h3 className="text-lg font-semibold text-primary border-b pb-2 mb-3">{category.title}</h3>
                        {category.keys.map((rateKey) => {
                           const rateIndex = formRates.findIndex(r => r.key === rateKey);
                           if (rateIndex === -1) return null;
                           const rate = formRates[rateIndex];
                           return (
                            <FormField
                              key={rate.key}
                              control={materialRatesForm.control}
                              name={`rates.${rateIndex}.value`}
                              render={({ field }) => (
                                <FormItem className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-2 border rounded-md hover:shadow-sm transition-shadow">
                                  <FormLabel className="capitalize flex-1 min-w-[180px] md:min-w-[200px] text-sm">{rate.key.replace(/_/g, ' ')}</FormLabel>
                                  <FormControl className="md:w-1/3">
                                    <Input type="number" step="0.0001" {...field}
                                      onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                    />
                                  </FormControl>
                                  <FormMessage className="md:w-auto text-xs"/>
                                </FormItem>
                              )}
                            />
                           );
                        })}
                      </div>
                    ))}
                  </CardContent>
                  
                  <div className="px-6 pt-4 pb-2 space-y-3 border-t mt-4">
                    <h4 className="text-md font-semibold text-foreground">Change Summary</h4>
                    {changeSummary.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">No unsaved changes.</p>
                    ) : (
                      <ScrollArea className="h-[150px] pr-3 border rounded-md p-2">
                        <ul className="space-y-1 text-sm">
                          {changeSummary.map(change => (
                            <li key={change.key} className="p-1.5 border-b last:border-b-0 rounded-sm bg-muted/30 hover:bg-muted/60">
                              <strong className="capitalize block text-foreground text-xs">{change.key.replace(/_/g, ' ')}:</strong>
                              <div className="flex justify-between items-center text-xs">
                                <span className="text-destructive line-through">{change.oldValue.toFixed(4)}</span>
                                <span className="text-green-600 font-medium">→ {change.newValue.toFixed(4)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </ScrollArea>
                    )}
                  </div>

                  <CardFooter className="flex flex-col md:flex-row justify-end gap-2 pt-6 border-t md:items-center mt-4">
                     <Link href="/rate-history" passHref>
                        <Button variant="outline" type="button" className="w-full md:w-auto"><HistoryIcon className="mr-2 h-4 w-4" /> View History</Button>
                     </Link>
                    <Button variant="outline" type="button" onClick={handleResetRates} disabled={isLoading || !hasChanges} className="w-full md:w-auto">
                        <RotateCcw className="mr-2 h-4 w-4" /> Reset Changes
                    </Button>
                    <Button type="submit" disabled={isLoading || !hasChanges} className="w-full md:w-auto">
                      {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save Changes</>}
                    </Button>
                  </CardFooter>
                </form>
              </Form>
              }
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
