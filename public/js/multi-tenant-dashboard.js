class MultiTenantDashboard {
    constructor() {
        this.userEmail = null;
        this.currentJobId = null;
        this.jobStatusInterval = null;
        this.connectedSheets = [];
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadUserEmail();
        await this.checkConnectionStatus();
        await this.loadConnectedSheets();
        await this.loadDataSummary();
    }

    setupEventListeners() {
        // Connection
        document.getElementById('connectBtn').addEventListener('click', () => this.connectGoogleSheets());
        
        // Sheet management
        document.getElementById('refreshSheetsBtn').addEventListener('click', () => this.loadConnectedSheets());
        document.getElementById('createSheetBtn').addEventListener('click', () => this.showCreateSheetModal());
        document.getElementById('connectExistingBtn').addEventListener('click', () => this.showConnectSheetModal());
        
        // Job control
        document.getElementById('startJobBtn').addEventListener('click', () => this.startJob());
        document.getElementById('pauseJobBtn').addEventListener('click', () => this.pauseJob());
        document.getElementById('stopJobBtn').addEventListener('click', () => this.stopJob());
        
        // Data management
        document.getElementById('refreshDataBtn').addEventListener('click', () => this.loadDataSummary());
        document.getElementById('exportCsvBtn').addEventListener('click', () => this.exportData('csv'));
        document.getElementById('exportJsonBtn').addEventListener('click', () => this.exportData('json'));
        
        // Modal handlers
        document.getElementById('confirmCreateSheet').addEventListener('click', () => this.createNewSheet());
        document.getElementById('cancelCreateSheet').addEventListener('click', () => this.hideCreateSheetModal());
        document.getElementById('confirmConnectSheet').addEventListener('click', () => this.connectExistingSheet());
        document.getElementById('cancelConnectSheet').addEventListener('click', () => this.hideConnectSheetModal());
    }

    async loadUserEmail() {
        // Get user email from URL params or prompt
        const urlParams = new URLSearchParams(window.location.search);
        this.userEmail = urlParams.get('userEmail') || localStorage.getItem('userEmail');
        
        if (!this.userEmail) {
            this.userEmail = prompt('Please enter your email address:');
            if (this.userEmail) {
                localStorage.setItem('userEmail', this.userEmail);
                // Update URL to include email
                window.history.replaceState({}, '', `${window.location.pathname}?userEmail=${encodeURIComponent(this.userEmail)}`);
            }
        }
        
        if (this.userEmail) {
            document.getElementById('userEmail').textContent = this.userEmail;
            localStorage.setItem('userEmail', this.userEmail);
        }
        
        // Check for connection success from URL params
        if (urlParams.get('connected') === 'true') {
            this.showNotification('Successfully connected to Google Sheets!', 'success');
            // Refresh connection status after successful OAuth
            setTimeout(() => this.checkConnectionStatus(), 1000);
        } else if (urlParams.get('error') === 'oauth_failed') {
            this.showNotification('OAuth connection failed. Please try again.', 'error');
        }
    }

    async checkConnectionStatus() {
        if (!this.userEmail) return;
        
        try {
            // Check if user has OAuth credentials and connected sheets
            const [authResponse, sheetsResponse] = await Promise.all([
                fetch(`/multi-tenant-sheets/auth/status?userEmail=${encodeURIComponent(this.userEmail)}`),
                fetch(`/multi-tenant-sheets/connected?userEmail=${encodeURIComponent(this.userEmail)}`)
            ]);
            
            const authData = await authResponse.json();
            const sheetsData = await sheetsResponse.json();
            
            // Debug logging
            console.log('Auth API response:', authData);
            console.log('Sheets API response:', sheetsData);
            
            const statusEl = document.getElementById('connectionStatus');
            const connectBtn = document.getElementById('connectBtn');
            
            const hasAuth = authData.success && authData.isConnected;
            const hasConnectedSheets = sheetsData.success && sheetsData.sheets && sheetsData.sheets.length > 0;
            
            if (hasAuth && hasConnectedSheets) {
                statusEl.innerHTML = '<i class="fas fa-check-circle status-connected mr-2"></i>Connected to Google Sheets';
                connectBtn.textContent = 'Reconnect';
                connectBtn.className = 'bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg transition-colors';
            } else if (hasAuth) {
                statusEl.innerHTML = '<i class="fas fa-check-circle text-yellow-500 mr-2"></i>Authenticated - No sheets connected';
                connectBtn.textContent = 'Connect Sheets';
                connectBtn.className = 'bg-yellow-600 hover:bg-yellow-700 text-white px-6 py-2 rounded-lg transition-colors';
            } else {
                statusEl.innerHTML = '<i class="fas fa-times-circle status-disconnected mr-2"></i>Not connected to Google Sheets';
                connectBtn.textContent = 'Connect Google Sheets';
                connectBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors';
            }
        } catch (error) {
            console.error('Error checking connection status:', error);
            document.getElementById('connectionStatus').innerHTML = '<i class="fas fa-exclamation-triangle text-yellow-500 mr-2"></i>Error checking connection';
        }
    }

    async connectGoogleSheets() {
        try {
            // Direct navigation to OAuth connect route - no fetch needed
            window.location.href = `/multi-tenant-sheets/auth/connect?userEmail=${encodeURIComponent(this.userEmail)}`;
        } catch (error) {
            console.error('Error connecting to Google Sheets:', error);
            this.showNotification(error.message || 'Error connecting to Google Sheets', 'error');
        }
    }

    async loadConnectedSheets() {
        try {
            const response = await fetch(`/multi-tenant-sheets/connected?userEmail=${encodeURIComponent(this.userEmail)}`);
            const data = await response.json();
            
            const sheetsContainer = document.getElementById('connectedSheets');
            const targetSheetSelect = document.getElementById('targetSheet');
            
            if (data.success && data.sheets && data.sheets.length > 0) {
                this.connectedSheets = data.sheets;
                
                // Update connected sheets display
                sheetsContainer.innerHTML = data.sheets.map(sheet => `
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                            <p class="font-medium">${sheet.sheet_name}</p>
                            <p class="text-sm text-gray-600">ID: ${sheet.sheet_id}</p>
                        </div>
                        <div class="flex space-x-2">
                            <button onclick="dashboard.openSheet('${sheet.sheet_id}')" class="text-blue-600 hover:text-blue-800">
                                <i class="fas fa-external-link-alt"></i>
                            </button>
                            <button onclick="dashboard.disconnectSheet('${sheet.sheet_id}')" class="text-red-600 hover:text-red-800">
                                <i class="fas fa-unlink"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
                
                // Update target sheet options
                targetSheetSelect.innerHTML = '<option value="">Select a sheet...</option>' + 
                    data.sheets.map(sheet => `<option value="${sheet.sheet_id}">${sheet.sheet_name}</option>`).join('');
            } else {
                sheetsContainer.innerHTML = '<p class="text-gray-500 text-center py-4">No sheets connected yet</p>';
                targetSheetSelect.innerHTML = '<option value="">No sheets available</option>';
            }
        } catch (error) {
            console.error('Error loading connected sheets:', error);
            document.getElementById('connectedSheets').innerHTML = '<p class="text-red-500 text-center py-4">Error loading sheets</p>';
        }
    }

    showCreateSheetModal() {
        document.getElementById('createSheetModal').classList.remove('hidden');
        document.getElementById('createSheetModal').classList.add('flex');
    }

    hideCreateSheetModal() {
        document.getElementById('createSheetModal').classList.add('hidden');
        document.getElementById('createSheetModal').classList.remove('flex');
        document.getElementById('newSheetName').value = '';
    }

    async createNewSheet() {
        const sheetName = document.getElementById('newSheetName').value.trim();
        if (!sheetName) {
            this.showNotification('Please enter a sheet name', 'error');
            return;
        }

        try {
            const response = await fetch('/multi-tenant-sheets/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userEmail: this.userEmail,
                    sheetName: sheetName
                })
            });

            const data = await response.json();
            if (data.success) {
                this.showNotification('Sheet created successfully!', 'success');
                this.hideCreateSheetModal();
                await this.loadConnectedSheets();
            } else {
                this.showNotification(data.message || 'Error creating sheet', 'error');
            }
        } catch (error) {
            console.error('Error creating sheet:', error);
            this.showNotification('Error creating sheet', 'error');
        }
    }

    async showConnectSheetModal() {
        document.getElementById('connectSheetModal').classList.remove('hidden');
        document.getElementById('connectSheetModal').classList.add('flex');
        
        // Load available sheets from Google Drive
        try {
            const response = await fetch(`/multi-tenant-sheets/available?userEmail=${encodeURIComponent(this.userEmail)}`);
            const data = await response.json();
            
            const select = document.getElementById('availableSheets');
            if (data.success && data.sheets && data.sheets.length > 0) {
                select.innerHTML = '<option value="">Select a sheet...</option>' + 
                    data.sheets.map(sheet => `<option value="${sheet.id}">${sheet.name}</option>`).join('');
            } else {
                // If no sheets from API, show manual input option
                select.innerHTML = '<option value="">No sheets found - you can create a new one instead</option>';
                this.showNotification('No existing sheets found. Try creating a new sheet instead.', 'info');
            }
        } catch (error) {
            console.error('Error loading available sheets:', error);
            document.getElementById('availableSheets').innerHTML = '<option value="">Error loading sheets - try creating new sheet</option>';
            this.showNotification('Could not load existing sheets. Try creating a new sheet instead.', 'warning');
        }
    }

    hideConnectSheetModal() {
        document.getElementById('connectSheetModal').classList.add('hidden');
        document.getElementById('connectSheetModal').classList.remove('flex');
    }

    async connectExistingSheet() {
        const sheetId = document.getElementById('availableSheets').value;
        if (!sheetId) {
            this.showNotification('Please select a sheet', 'error');
            return;
        }

        try {
            const response = await fetch('/multi-tenant-sheets/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userEmail: this.userEmail,
                    sheetId: sheetId
                })
            });

            const data = await response.json();
            if (data.success) {
                this.showNotification('Sheet connected successfully!', 'success');
                this.hideConnectSheetModal();
                await this.loadConnectedSheets();
            } else {
                this.showNotification(data.message || 'Error connecting sheet', 'error');
            }
        } catch (error) {
            console.error('Error connecting sheet:', error);
            this.showNotification('Error connecting sheet', 'error');
        }
    }

    async startJob() {
        const keywords = document.getElementById('searchKeywords').value.trim();
        const location = document.getElementById('searchLocation').value.trim();
        const method = document.getElementById('scrapingMethod').value;
        const maxResults = document.getElementById('maxResults').value;
        const targetSheet = document.getElementById('targetSheet').value;

        if (!keywords || !location) {
            this.showNotification('Please enter search keywords and location', 'error');
            return;
        }

        if (!targetSheet) {
            this.showNotification('Please select a target sheet', 'error');
            return;
        }

        try {
            const response = await fetch('/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keywords: keywords,
                    location: location,
                    method: method,
                    maxResults: parseInt(maxResults),
                    userEmail: this.userEmail,
                    targetSheetId: targetSheet
                })
            });

            const data = await response.json();
            if (data.success && data.jobId) {
                this.currentJobId = data.jobId;
                this.showJobStatus();
                this.startJobStatusPolling();
                this.showNotification('Job started successfully!', 'success');
            } else {
                this.showNotification(data.message || 'Error starting job', 'error');
            }
        } catch (error) {
            console.error('Error starting job:', error);
            this.showNotification('Error starting job', 'error');
        }
    }

    async pauseJob() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`/pause/${this.currentJobId}`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                this.showNotification('Job paused', 'info');
            }
        } catch (error) {
            console.error('Error pausing job:', error);
        }
    }

    async stopJob() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`/stop/${this.currentJobId}`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                this.showNotification('Job stopped', 'info');
                this.stopJobStatusPolling();
                this.hideJobStatus();
            }
        } catch (error) {
            console.error('Error stopping job:', error);
        }
    }

    showJobStatus() {
        document.getElementById('jobStatus').classList.remove('hidden');
        document.getElementById('startJobBtn').disabled = true;
        document.getElementById('pauseJobBtn').disabled = false;
        document.getElementById('stopJobBtn').disabled = false;
    }

    hideJobStatus() {
        document.getElementById('jobStatus').classList.add('hidden');
        document.getElementById('startJobBtn').disabled = false;
        document.getElementById('pauseJobBtn').disabled = true;
        document.getElementById('stopJobBtn').disabled = true;
        this.currentJobId = null;
    }

    startJobStatusPolling() {
        if (this.jobStatusInterval) clearInterval(this.jobStatusInterval);
        
        this.jobStatusInterval = setInterval(async () => {
            if (!this.currentJobId) return;
            
            try {
                const response = await fetch(`/status/${this.currentJobId}`);
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('jobId').textContent = this.currentJobId;
                    document.getElementById('jobStatusText').textContent = data.status || 'Running';
                    document.getElementById('jobProgress').textContent = `${data.processed || 0}/${data.total || 0}`;
                    document.getElementById('jobStartTime').textContent = data.startTime || '-';
                    document.getElementById('jobMethod').textContent = data.method || '-';
                    
                    const progress = data.total > 0 ? (data.processed / data.total) * 100 : 0;
                    document.getElementById('progressBar').style.width = `${progress}%`;
                    
                    // Update save statistics if available
                    if (data.saveStats) {
                        const pgStats = data.saveStats.postgresql || { success: 0, failed: 0 };
                        const sheetStats = data.saveStats.googleSheets || { success: 0, failed: 0 };
                        const bothSuccess = data.saveStats.bothSucceeded || 0;
                        
                        document.getElementById('postgresqlStats').textContent = `${pgStats.success}✓/${pgStats.failed}✗`;
                        document.getElementById('sheetsStats').textContent = `${sheetStats.success}✓/${sheetStats.failed}✗`;
                        document.getElementById('bothStats').textContent = bothSuccess;
                    }
                    
                    if (data.status === 'completed' || data.status === 'stopped' || data.status === 'failed') {
                        this.stopJobStatusPolling();
                        if (data.status === 'completed') {
                            this.showNotification('Job completed successfully!', 'success');
                            await this.loadDataSummary();
                        }
                        setTimeout(() => this.hideJobStatus(), 3000);
                    }
                }
            } catch (error) {
                console.error('Error checking job status:', error);
            }
        }, 2000);
    }

    stopJobStatusPolling() {
        if (this.jobStatusInterval) {
            clearInterval(this.jobStatusInterval);
            this.jobStatusInterval = null;
        }
    }

    async loadDataSummary() {
        try {
            const response = await fetch(`/user-data/summary?userEmail=${encodeURIComponent(this.userEmail)}`);
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('totalRecords').textContent = data.summary.totalRecords || 0;
                document.getElementById('totalCities').textContent = data.summary.uniqueCities || 0;
                document.getElementById('totalKeywords').textContent = data.summary.uniqueKeywords || 0;
                document.getElementById('recentJobs').textContent = data.summary.uniqueJobs || 0;
            }
            
            // Load recent data
            const recentResponse = await fetch(`/user-data/recent?userEmail=${encodeURIComponent(this.userEmail)}&limit=5`);
            const recentData = await recentResponse.json();
            
            const tableBody = document.getElementById('recentDataTable');
            if (recentData.success && recentData.data && recentData.data.length > 0) {
                tableBody.innerHTML = recentData.data.map(item => `
                    <tr class="border-b border-gray-100">
                        <td class="p-2">${item.business_name || 'N/A'}</td>
                        <td class="p-2">${item.city || 'N/A'}</td>
                        <td class="p-2">${item.rating ? item.rating + '⭐' : 'N/A'}</td>
                        <td class="p-2">${new Date(item.created_at).toLocaleDateString()}</td>
                    </tr>
                `).join('');
            } else {
                tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">No data available</td></tr>';
            }
        } catch (error) {
            console.error('Error loading data summary:', error);
        }
    }

    async exportData(format) {
        try {
            const url = `/user-data/export/${format}?userEmail=${encodeURIComponent(this.userEmail)}`;
            window.open(url, '_blank');
            this.showNotification(`Exporting data as ${format.toUpperCase()}...`, 'info');
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showNotification('Error exporting data', 'error');
        }
    }

    async openSheet(sheetId) {
        const sheet = this.connectedSheets.find(s => s.sheet_id === sheetId);
        if (sheet && sheet.sheet_url) {
            window.open(sheet.sheet_url, '_blank');
        }
    }

    async disconnectSheet(sheetId) {
        if (!confirm('Are you sure you want to disconnect this sheet?')) return;

        try {
            const response = await fetch(`/multi-tenant-sheets/${sheetId}?userEmail=${encodeURIComponent(this.userEmail)}`, {
                method: 'DELETE'
            });

            const data = await response.json();
            if (data.success) {
                this.showNotification('Sheet disconnected successfully', 'success');
                await this.loadConnectedSheets();
            } else {
                this.showNotification(data.message || 'Error disconnecting sheet', 'error');
            }
        } catch (error) {
            console.error('Error disconnecting sheet:', error);
            this.showNotification('Error disconnecting sheet', 'error');
        }
    }

    showNotification(message, type = 'info') {
        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            info: 'bg-blue-500',
            warning: 'bg-yellow-500'
        };

        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 transform translate-x-full transition-transform duration-300`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);

        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Initialize dashboard
const dashboard = new MultiTenantDashboard();
