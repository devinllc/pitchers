// Global variables
let token = localStorage.getItem('token');
let currentView = 'dashboard';

// Check if user is logged in
document.addEventListener('DOMContentLoaded', function() {
    // For development: create a token for the default admin user
    if (!token) {
        console.log('Creating admin token for development mode');
        
        // Use the default admin credentials from the server
        const adminEmail = 'admin@example.com';
        
        // Create a JWT-like token structure with admin privileges
        // Use standard base64url encoding (replace + with - and / with _)
        const headerObj = { alg: 'HS256', typ: 'JWT' };
        const payloadObj = {
            sub: adminEmail,
            email: adminEmail,
            name: 'Admin User',
            role: 'admin',
            is_admin: true,
            is_super_admin: true,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        };
        
        // Convert to base64url format
        const toBase64Url = (obj) => {
            return btoa(JSON.stringify(obj))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        };
        
        const header = toBase64Url(headerObj);
        const payload = toBase64Url(payloadObj);
        const signature = toBase64Url('mock_signature_for_development');
        
        const adminToken = `${header}.${payload}.${signature}`;
        localStorage.setItem('token', adminToken);
        token = adminToken;
        
        console.log('Admin token created successfully');
    }
    
    // In production, uncomment these lines:
    // if (!token) {
    //     window.location.href = '/auth-login.html';
    //     return;
    // }
    
    // Load dashboard data
    loadDashboard();
    
    // Set up navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const view = this.getAttribute('href').substring(1);
            navigateTo(view);
        });
    });
    
    // Set up logout button
    document.getElementById('logoutBtn').addEventListener('click', function(e) {
        e.preventDefault();
        logout();
    });
    
    // Set up assign plan button
    document.getElementById('assignPlanBtn').addEventListener('click', function() {
        assignPlan();
    });

    // Load available plans for the modal
    loadPlans();
});

// Navigation function
function navigateTo(view) {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`.nav-link[href="#${view}"]`).classList.add('active');
    
    currentView = view;
    
    switch (view) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'users':
            loadUsers();
            break;
        case 'subscriptions':
            loadSubscriptions();
            break;
        case 'usage':
            loadUsage();
            break;
        case 'admins':
            loadAdmins();
            break;
    }
}

// API request helper
async function apiRequest(endpoint, method = 'GET', body = null) {
    showLoading();
    
    try {
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        try {
            const response = await fetch(`/admin/${endpoint}`, options);
            
            // Try to parse JSON, but don't fail if it's not valid
            let data;
            try {
                data = await response.json();
            } catch (jsonError) {
                console.warn('Failed to parse JSON response:', jsonError);
                throw new Error('Invalid response from server');
            }
            
            if (!response.ok) {
                console.warn(`API request failed (${response.status}):`, data.message || 'Unknown error');
                throw new Error(data.message || `Request failed with status ${response.status}`);
            }
            
            return data;
        } catch (fetchError) {
            console.warn('API request failed:', fetchError);
            throw fetchError;
        }
    } catch (error) {
        console.error('API request error:', error);
        throw error;
    } finally {
        hideLoading();
    }
}

// Mock data for development purposes
function getMockData(endpoint) {
    console.log('Returning mock data for endpoint:', endpoint);
    
    // Dashboard mock data
    if (endpoint === 'dashboard') {
        return {
            success: true,
            statistics: {
                userCount: 42,
                activeSubscriptions: 28,
                totalJobs: 156,
                monthlyUsage: 1250
            },
            planDistribution: [
                { name: 'Free', count: 14 },
                { name: 'Basic', count: 18 },
                { name: 'Pro', count: 8 },
                { name: 'Enterprise', count: 2 }
            ],
            recentUsers: [
                { email: 'user1@example.com', name: 'User One', created_at: new Date().toISOString() },
                { email: 'user2@example.com', name: 'User Two', created_at: new Date().toISOString() },
                { email: 'user3@example.com', name: 'User Three', created_at: new Date().toISOString() }
            ],
            recentSubscriptions: [
                { user_email: 'user1@example.com', plan_name: 'Pro', status: 'active', created_at: new Date().toISOString() },
                { user_email: 'user2@example.com', plan_name: 'Basic', status: 'active', created_at: new Date().toISOString() },
                { user_email: 'user3@example.com', plan_name: 'Free', status: 'active', created_at: new Date().toISOString() }
            ]
        };
    }
    
    // Users mock data
    if (endpoint === 'users') {
        return {
            success: true,
            users: [
                { email: 'user1@example.com', name: 'User One', plan_name: 'Pro', subscription_status: 'active', subscription_expires_at: new Date(Date.now() + 30*24*60*60*1000).toISOString() },
                { email: 'user2@example.com', name: 'User Two', plan_name: 'Basic', subscription_status: 'active', subscription_expires_at: new Date(Date.now() + 30*24*60*60*1000).toISOString() },
                { email: 'user3@example.com', name: 'User Three', plan_name: 'Free', subscription_status: 'active', subscription_expires_at: new Date(Date.now() + 30*24*60*60*1000).toISOString() }
            ],
            pagination: {
                page: 1,
                limit: 20,
                totalUsers: 42,
                totalPages: 3
            }
        };
    }
    
    // Default mock data
    return {
        success: true,
        message: 'Mock data for development'
    };
}

// Loading indicator
function showLoading() {
    document.getElementById('loading').classList.remove('d-none');
}

function hideLoading() {
    document.getElementById('loading').classList.add('d-none');
}

// Logout function
function logout() {
    // Remove the token
    localStorage.removeItem('token');
    
    // In development mode, redirect to the same page (will auto-create a token)
    console.log('Logout requested');
    
    // Reload the current page
    window.location.reload();
    
    // In production, uncomment this:
    // window.location.href = '/auth-login.html';
}

// Format date
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Load plans for assign plan modal
async function loadPlans() {
    try {
        const data = await apiRequest('subscription/plans');
        
        const planSelect = document.getElementById('planSelect');
        planSelect.innerHTML = '';
        
        if (!data.plans || data.plans.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No plans available';
            option.disabled = true;
            option.selected = true;
            planSelect.appendChild(option);
            return;
        }
        
        data.plans.forEach(plan => {
            const option = document.createElement('option');
            option.value = plan.id;
            option.textContent = `${plan.name} (${plan.price} ${plan.currency || 'INR'})`;
            planSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load plans:', error);
        
        const planSelect = document.getElementById('planSelect');
        planSelect.innerHTML = '';
        
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Error loading plans';
        option.disabled = true;
        option.selected = true;
        planSelect.appendChild(option);
        
        showError('Failed to load plans: ' + error.message);
    }
}

// Load dashboard data
async function loadDashboard() {
    try {
        const data = await apiRequest('dashboard');
        
        // Extract statistics with defaults for missing data
        const statistics = data.statistics || {
            userCount: 0,
            activeSubscriptions: 0,
            totalJobs: 0,
            monthlyUsage: 0
        };
        
        // Extract plan distribution with empty array fallback
        const planDistribution = data.planDistribution || [];
        
        // Extract recent users with empty array fallback
        const recentUsers = data.recentUsers || [];
        
        // Extract recent subscriptions with empty array fallback
        const recentSubscriptions = data.recentSubscriptions || [];
        
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div id="dashboardView">
                <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
                    <h1 class="h2">Dashboard</h1>
                    <div class="btn-toolbar mb-2 mb-md-0">
                        <button type="button" class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#assignPlanModal">
                            <i class="bi bi-plus-circle me-1"></i> Assign Plan
                        </button>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-xl-3 col-md-6 mb-4">
                        <div class="card shadow h-100 py-2 card-dashboard card-users">
                            <div class="card-body">
                                <div class="row no-gutters align-items-center">
                                    <div class="col mr-2">
                                        <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Total Users</div>
                                        <div class="h5 mb-0 font-weight-bold text-gray-800">${statistics.userCount}</div>
                                    </div>
                                    <div class="col-auto">
                                        <i class="bi bi-people fs-2 text-gray-300"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-xl-3 col-md-6 mb-4">
                        <div class="card shadow h-100 py-2 card-dashboard card-subscriptions">
                            <div class="card-body">
                                <div class="row no-gutters align-items-center">
                                    <div class="col mr-2">
                                        <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Active Subscriptions</div>
                                        <div class="h5 mb-0 font-weight-bold text-gray-800">${statistics.activeSubscriptions}</div>
                                    </div>
                                    <div class="col-auto">
                                        <i class="bi bi-credit-card fs-2 text-gray-300"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-xl-3 col-md-6 mb-4">
                        <div class="card shadow h-100 py-2 card-dashboard card-jobs">
                            <div class="card-body">
                                <div class="row no-gutters align-items-center">
                                    <div class="col mr-2">
                                        <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">Total Jobs</div>
                                        <div class="h5 mb-0 font-weight-bold text-gray-800">${statistics.totalJobs}</div>
                                    </div>
                                    <div class="col-auto">
                                        <i class="bi bi-list-task fs-2 text-gray-300"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-xl-3 col-md-6 mb-4">
                        <div class="card shadow h-100 py-2 card-dashboard card-usage">
                            <div class="card-body">
                                <div class="row no-gutters align-items-center">
                                    <div class="col mr-2">
                                        <div class="text-xs font-weight-bold text-danger text-uppercase mb-1">Monthly Usage</div>
                                        <div class="h5 mb-0 font-weight-bold text-gray-800">${statistics.monthlyUsage}</div>
                                    </div>
                                    <div class="col-auto">
                                        <i class="bi bi-graph-up fs-2 text-gray-300"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col-lg-6">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">Plan Distribution</h6>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-bordered">
                                        <thead>
                                            <tr>
                                                <th>Plan</th>
                                                <th>Users</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${planDistribution.length > 0 ? 
                                                planDistribution.map(plan => `
                                                    <tr>
                                                        <td>${plan.name}</td>
                                                        <td>${plan.count}</td>
                                                    </tr>
                                                `).join('') : 
                                                '<tr><td colspan="2" class="text-center">No plan data available</td></tr>'
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-6">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">Recent Users</h6>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-bordered">
                                        <thead>
                                            <tr>
                                                <th>Email</th>
                                                <th>Name</th>
                                                <th>Joined</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${recentUsers.length > 0 ? 
                                                recentUsers.map(user => `
                                                    <tr>
                                                        <td>${user.email}</td>
                                                        <td>${user.name || '-'}</td>
                                                        <td>${formatDate(user.created_at)}</td>
                                                    </tr>
                                                `).join('') : 
                                                '<tr><td colspan="3" class="text-center">No recent users</td></tr>'
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row">
                    <div class="col-12">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">Recent Subscriptions</h6>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-bordered">
                                        <thead>
                                            <tr>
                                                <th>User Email</th>
                                                <th>Plan</th>
                                                <th>Status</th>
                                                <th>Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${recentSubscriptions.length > 0 ? 
                                                recentSubscriptions.map(sub => `
                                                    <tr>
                                                        <td>${sub.user_email}</td>
                                                        <td>${sub.plan_name}</td>
                                                        <td>${sub.status}</td>
                                                        <td>${formatDate(sub.created_at)}</td>
                                                    </tr>
                                                `).join('') : 
                                                '<tr><td colspan="4" class="text-center">No recent subscriptions</td></tr>'
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div class="alert alert-danger mt-4" role="alert">
                <h4 class="alert-heading">Error Loading Dashboard</h4>
                <p>${error.message}</p>
                <hr>
                <p class="mb-0">Please try again later or contact the system administrator.</p>
            </div>
        `;
    }
}

// Load users data
async function loadUsers(page = 1, searchTerm = '') {
    try {
        // Add query parameters for pagination and search
        let endpoint = `users?page=${page}`;
        if (searchTerm) {
            endpoint += `&search=${encodeURIComponent(searchTerm)}`;
        }
        
        const data = await apiRequest(endpoint);
        
        // Extract users with empty array fallback
        const users = data.users || [];
        
        // Extract pagination with defaults
        const pagination = data.pagination || {
            page: 1,
            limit: 20,
            totalUsers: 0,
            totalPages: 1
        };
        
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div id="usersView">
                <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
                    <h1 class="h2">Users</h1>
                    <div class="btn-toolbar mb-2 mb-md-0">
                        <button type="button" class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#assignPlanModal">
                            <i class="bi bi-plus-circle me-1"></i> Assign Plan
                        </button>
                    </div>
                </div>
                
                <div class="card shadow mb-4">
                    <div class="card-header py-3 d-flex flex-row align-items-center justify-content-between">
                        <h6 class="m-0 font-weight-bold text-primary">All Users</h6>
                        <div class="input-group w-50">
                            <input type="text" class="form-control" placeholder="Search users..." id="userSearchInput" value="${searchTerm}">
                            <button class="btn btn-primary" type="button" id="userSearchBtn">
                                <i class="bi bi-search"></i>
                            </button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>Email</th>
                                        <th>Name</th>
                                        <th>Plan</th>
                                        <th>Status</th>
                                        <th>Expires</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${users.length > 0 ? 
                                        users.map(user => `
                                            <tr>
                                                <td>${user.email}</td>
                                                <td>${user.name || '-'}</td>
                                                <td>${user.plan_name || 'No Plan'}</td>
                                                <td>${user.subscription_status || 'No Subscription'}</td>
                                                <td>${formatDate(user.subscription_expires_at)}</td>
                                                <td>
                                                    <button class="btn btn-sm btn-info view-user-btn" data-email="${user.email}">
                                                        <i class="bi bi-eye"></i>
                                                    </button>
                                                    <button class="btn btn-sm btn-primary assign-plan-btn" data-email="${user.email}">
                                                        <i class="bi bi-credit-card"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        `).join('') : 
                                        '<tr><td colspan="6" class="text-center">No users found</td></tr>'
                                    }
                                </tbody>
                            </table>
                        </div>
                        
                        ${pagination.totalPages > 1 ? `
                            <nav aria-label="Page navigation">
                                <ul class="pagination justify-content-center">
                                    <li class="page-item ${pagination.page <= 1 ? 'disabled' : ''}">
                                        <a class="page-link" href="#" data-page="${pagination.page - 1}">Previous</a>
                                    </li>
                                    ${Array.from({length: Math.min(5, pagination.totalPages)}, (_, i) => {
                                        const pageNum = i + 1;
                                        return `
                                            <li class="page-item ${pageNum === pagination.page ? 'active' : ''}">
                                                <a class="page-link" href="#" data-page="${pageNum}">${pageNum}</a>
                                            </li>
                                        `;
                                    }).join('')}
                                    <li class="page-item ${pagination.page >= pagination.totalPages ? 'disabled' : ''}">
                                        <a class="page-link" href="#" data-page="${pagination.page + 1}">Next</a>
                                    </li>
                                </ul>
                            </nav>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // Set up event listeners for pagination
        document.querySelectorAll('.page-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const page = this.getAttribute('data-page');
                loadUsers(page, searchTerm);
            });
        });
        
        // Set up event listeners for user search
        document.getElementById('userSearchBtn').addEventListener('click', function() {
            const newSearchTerm = document.getElementById('userSearchInput').value;
            loadUsers(1, newSearchTerm);
        });
        
        // Add enter key support for search
        document.getElementById('userSearchInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const newSearchTerm = document.getElementById('userSearchInput').value;
                loadUsers(1, newSearchTerm);
            }
        });
        
        // Set up event listeners for view user button
        document.querySelectorAll('.view-user-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const email = this.getAttribute('data-email');
                loadUserDetails(email);
            });
        });
        
        // Set up event listeners for assign plan button
        document.querySelectorAll('.assign-plan-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const email = this.getAttribute('data-email');
                document.getElementById('userEmail').value = email;
                const modal = new bootstrap.Modal(document.getElementById('assignPlanModal'));
                modal.show();
            });
        });
        
    } catch (error) {
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div class="alert alert-danger mt-4" role="alert">
                <h4 class="alert-heading">Error Loading Users</h4>
                <p>${error.message}</p>
                <hr>
                <p class="mb-0">Please try again later or contact the system administrator.</p>
            </div>
        `;
    }
}

// Load subscriptions data
async function loadSubscriptions() {
    try {
        const data = await apiRequest('subscriptions/statistics');
        
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div id="subscriptionsView">
                <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
                    <h1 class="h2">Subscriptions</h1>
                </div>
                
                <!-- Implementation for subscriptions view -->
            </div>
        `;
    } catch (error) {
        showError('Failed to load subscriptions data: ' + error.message);
    }
}

// Load usage data
async function loadUsage() {
    try {
        const data = await apiRequest('usage/statistics');
        
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div id="usageView">
                <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
                    <h1 class="h2">Usage</h1>
                </div>
                
                <!-- Implementation for usage view -->
            </div>
        `;
    } catch (error) {
        showError('Failed to load usage data: ' + error.message);
    }
}

// Load admins data
async function loadAdmins() {
    try {
        const data = await apiRequest('admins');
        
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div id="adminsView">
                <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
                    <h1 class="h2">Admin Users</h1>
                </div>
                
                <!-- Implementation for admins view -->
            </div>
        `;
    } catch (error) {
        showError('Failed to load admins data: ' + error.message);
    }
}

// Load user details
async function loadUserDetails(email) {
    try {
        const data = await apiRequest(`users/${email}`);
        
        // Extract user with default empty object
        const user = data.user || {};
        
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div id="userDetailsView">
                <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
                    <h1 class="h2">User Details: ${email}</h1>
                    <div class="btn-toolbar mb-2 mb-md-0">
                        <button type="button" class="btn btn-sm btn-secondary me-2" id="backToUsersBtn">
                            <i class="bi bi-arrow-left me-1"></i> Back to Users
                        </button>
                        <button type="button" class="btn btn-sm btn-primary" data-bs-toggle="modal" data-bs-target="#assignPlanModal">
                            <i class="bi bi-plus-circle me-1"></i> Assign Plan
                        </button>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">User Information</h6>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-bordered">
                                        <tbody>
                                            <tr>
                                                <th>Email</th>
                                                <td>${user.email || email}</td>
                                            </tr>
                                            <tr>
                                                <th>Name</th>
                                                <td>${user.name || '-'}</td>
                                            </tr>
                                            <tr>
                                                <th>Created</th>
                                                <td>${formatDate(user.created_at)}</td>
                                            </tr>
                                            <tr>
                                                <th>Last Login</th>
                                                <td>${formatDate(user.last_login)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-md-6">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">Subscription Details</h6>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-bordered">
                                        <tbody>
                                            <tr>
                                                <th>Plan</th>
                                                <td>${user.plan_name || 'No Plan'}</td>
                                            </tr>
                                            <tr>
                                                <th>Status</th>
                                                <td>${user.subscription_status || 'No Subscription'}</td>
                                            </tr>
                                            <tr>
                                                <th>Started</th>
                                                <td>${formatDate(user.subscription_started_at)}</td>
                                            </tr>
                                            <tr>
                                                <th>Expires</th>
                                                <td>${formatDate(user.subscription_expires_at)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-12">
                        <div class="card shadow mb-4">
                            <div class="card-header py-3">
                                <h6 class="m-0 font-weight-bold text-primary">Usage Statistics</h6>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-bordered">
                                        <tbody>
                                            <tr>
                                                <th>API Calls</th>
                                                <td>${user.usage_count || 0}</td>
                                            </tr>
                                            <tr>
                                                <th>Usage Limit</th>
                                                <td>${user.usage_limit || 'Unlimited'}</td>
                                            </tr>
                                            <tr>
                                                <th>Last API Call</th>
                                                <td>${formatDate(user.last_api_call)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Set up back button
        document.getElementById('backToUsersBtn').addEventListener('click', function() {
            loadUsers();
        });
        
        // Pre-fill the assign plan modal with this user's email
        document.getElementById('userEmail').value = email;
        
    } catch (error) {
        const contentDiv = document.getElementById('content');
        contentDiv.innerHTML = `
            <div class="alert alert-danger mt-4" role="alert">
                <h4 class="alert-heading">Error Loading User Details</h4>
                <p>${error.message}</p>
                <hr>
                <p class="mb-0">Please try again later or contact the system administrator.</p>
                <button class="btn btn-secondary mt-3" id="backToUsersBtn">
                    <i class="bi bi-arrow-left me-1"></i> Back to Users
                </button>
            </div>
        `;
        
        // Set up back button even in error state
        document.getElementById('backToUsersBtn').addEventListener('click', function() {
            loadUsers();
        });
    }
}

// Assign plan to user
async function assignPlan() {
    const userEmail = document.getElementById('userEmail').value;
    const planId = document.getElementById('planSelect').value;
    const expiryDate = document.getElementById('expiryDate').value;
    
    if (!userEmail || !planId) {
        showError('Please fill in all required fields');
        return;
    }
    
    try {
        const data = await apiRequest('users/assign-plan', 'POST', {
            email: userEmail,
            planId: parseInt(planId),
            expiresAt: expiryDate || undefined
        });
        
        // Show success message
        showSuccess('Plan assigned successfully');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('assignPlanModal'));
        modal.hide();
        
        // Clear form
        document.getElementById('userEmail').value = '';
        document.getElementById('expiryDate').value = '';
        
        // Reload current view
        navigateTo(currentView);
        
    } catch (error) {
        showError('Failed to assign plan: ' + error.message);
    }
}

// Show error message
function showError(message) {
    alert(message);
}

// Show success message
function showSuccess(message) {
    alert(message);
}
