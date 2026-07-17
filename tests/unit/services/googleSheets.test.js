const GoogleSheetsService = require('../../../services/googleSheets');
const { google } = require('googleapis');
const fs = require('fs').promises;

// Mock googleapis
jest.mock('googleapis');
const mockedGoogle = google;

// Mock fs.promises
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        access: jest.fn()
    }
}));

// Mock ErrorHandler
jest.mock('../../../services/errorHandler', () => {
    return jest.fn().mockImplementation(() => ({
        logProgress: jest.fn(),
        logDataSave: jest.fn(),
        logDataSaveFailure: jest.fn(),
        logAndContinue: jest.fn()
    }));
});

describe('GoogleSheetsService', () => {
    let googleSheetsService;
    let mockSheets;
    let mockAuth;
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
        process.env.GOOGLE_SHEETS_CREDENTIALS_PATH = './test-credentials.json';
        process.env.NODE_ENV = 'test';

        // Mock sheets API
        mockSheets = {
            spreadsheets: {
                values: {
                    append: jest.fn(),
                    update: jest.fn()
                },
                get: jest.fn()
            }
        };

        // Mock auth
        mockAuth = {
            setCredentials: jest.fn()
        };

        mockedGoogle.sheets.mockReturnValue(mockSheets);
        mockedGoogle.auth = {
            GoogleAuth: jest.fn().mockImplementation(() => mockAuth),
            OAuth2: jest.fn().mockImplementation(() => mockAuth)
        };

        googleSheetsService = new GoogleSheetsService();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor', () => {
        it('should initialize with environment variables', () => {
            expect(googleSheetsService.spreadsheetId).toBe('test-spreadsheet-id');
            expect(googleSheetsService.credentialsPath).toBe('./test-credentials.json');
        });

        it('should enable mock mode in development', () => {
            process.env.NODE_ENV = 'development';
            process.env.GOOGLE_SHEETS_MOCK = 'true';
            const service = new GoogleSheetsService();
            expect(service.mockMode).toBe(true);
        });
    });

    describe('authenticate', () => {
        const mockServiceAccountCredentials = {
            type: 'service_account',
            project_id: 'test-project',
            private_key_id: 'test-key-id',
            private_key: '-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----\n',
            client_email: 'test@test-project.iam.gserviceaccount.com',
            client_id: 'test-client-id'
        };

        const mockOAuth2Credentials = {
            client_id: 'test-client-id',
            client_secret: 'test-client-secret',
            refresh_token: 'test-refresh-token',
            access_token: 'test-access-token'
        };

        it('should authenticate with service account credentials', async () => {
            fs.access.mockResolvedValue();
            fs.readFile.mockResolvedValue(JSON.stringify(mockServiceAccountCredentials));

            const result = await googleSheetsService.authenticate();

            expect(result).toBe(true);
            expect(mockedGoogle.auth.GoogleAuth).toHaveBeenCalledWith({
                credentials: mockServiceAccountCredentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            expect(mockedGoogle.sheets).toHaveBeenCalledWith({ version: 'v4', auth: mockAuth });
        });

        it('should authenticate with OAuth2 credentials', async () => {
            fs.access.mockResolvedValue();
            fs.readFile.mockResolvedValue(JSON.stringify(mockOAuth2Credentials));

            const result = await googleSheetsService.authenticate();

            expect(result).toBe(true);
            expect(mockedGoogle.auth.OAuth2).toHaveBeenCalledWith(
                mockOAuth2Credentials.client_id,
                mockOAuth2Credentials.client_secret,
                mockOAuth2Credentials.redirect_uri
            );
            expect(mockAuth.setCredentials).toHaveBeenCalledWith({
                refresh_token: mockOAuth2Credentials.refresh_token,
                access_token: mockOAuth2Credentials.access_token
            });
        });

        it('should create credentials template if file does not exist', async () => {
            fs.access.mockRejectedValue(new Error('File not found'));
            fs.writeFile.mockResolvedValue();

            await expect(googleSheetsService.authenticate())
                .rejects.toThrow('Please configure Google Sheets credentials');

            expect(fs.writeFile).toHaveBeenCalledWith(
                './test-credentials.json',
                expect.stringContaining('_comment')
            );
        });

        it('should reject template credentials', async () => {
            const templateCredentials = {
                _comment: 'Choose ONE of the following authentication methods:',
                client_id: 'your_google_oauth_client_id'
            };

            fs.access.mockResolvedValue();
            fs.readFile.mockResolvedValue(JSON.stringify(templateCredentials));

            await expect(googleSheetsService.authenticate())
                .rejects.toThrow('Please replace the template credentials');
        });

        it('should handle invalid credentials format', async () => {
            const invalidCredentials = { invalid: 'format' };

            fs.access.mockResolvedValue();
            fs.readFile.mockResolvedValue(JSON.stringify(invalidCredentials));

            await expect(googleSheetsService.authenticate())
                .rejects.toThrow('Invalid credentials format');
        });
    });

    describe('testConnection', () => {
        it('should test connection successfully', async () => {
            const mockSpreadsheetResponse = {
                data: {
                    properties: { title: 'Test Spreadsheet' },
                    sheets: [{ properties: { title: 'Sheet1' } }]
                }
            };

            googleSheetsService.sheets = mockSheets;
            mockSheets.spreadsheets.get.mockResolvedValue(mockSpreadsheetResponse);

            const result = await googleSheetsService.testConnection();

            expect(result).toBe(true);
            expect(mockSheets.spreadsheets.get).toHaveBeenCalledWith({
                spreadsheetId: 'test-spreadsheet-id'
            });
        });

        it('should handle connection test failure', async () => {
            googleSheetsService.sheets = mockSheets;
            mockSheets.spreadsheets.get.mockRejectedValue(new Error('Connection failed'));

            const result = await googleSheetsService.testConnection();

            expect(result).toBe(false);
        });

        it('should skip connection test in mock mode', async () => {
            googleSheetsService.mockMode = true;

            const result = await googleSheetsService.testConnection();

            expect(result).toBe(true);
            expect(mockSheets.spreadsheets.get).not.toHaveBeenCalled();
        });
    });

    describe('appendRow', () => {
        const mockBusinessData = {
            name: 'Test Business',
            address: '123 Test Street',
            phone: '+91 98765 43210',
            website: 'https://testbusiness.com'
        };

        const mockAppendResponse = {
            data: {
                updates: {
                    updatedRows: 1,
                    updatedRange: 'Sheet1!A2:D2'
                }
            }
        };

        it('should append row successfully', async () => {
            googleSheetsService.sheets = mockSheets;
            mockSheets.spreadsheets.values.append.mockResolvedValue(mockAppendResponse);

            const result = await googleSheetsService.appendRow(mockBusinessData);

            expect(result).toEqual({
                updatedRows: 1,
                updatedRange: 'Sheet1!A2:D2',
                businessName: 'Test Business',
                placeId: undefined,
                timestamp: expect.any(String)
            });

            expect(mockSheets.spreadsheets.values.append).toHaveBeenCalledWith({
                spreadsheetId: 'test-spreadsheet-id',
                range: 'Sheet1!A:D',
                valueInputOption: 'RAW',
                resource: {
                    values: [[
                        'Test Business',
                        '123 Test Street',
                        '+91 98765 43210',
                        'https://testbusiness.com'
                    ]]
                }
            });
        });

        it('should handle missing business data fields', async () => {
            const incompleteData = { name: 'Test Business' };
            googleSheetsService.sheets = mockSheets;
            mockSheets.spreadsheets.values.append.mockResolvedValue(mockAppendResponse);

            const result = await googleSheetsService.appendRow(incompleteData);

            expect(mockSheets.spreadsheets.values.append).toHaveBeenCalledWith({
                spreadsheetId: 'test-spreadsheet-id',
                range: 'Sheet1!A:D',
                valueInputOption: 'RAW',
                resource: {
                    values: [['Test Business', '', '', '']]
                }
            });
        });

        it('should work in mock mode', async () => {
            googleSheetsService.mockMode = true;

            const result = await googleSheetsService.appendRow(mockBusinessData);

            expect(result).toEqual({
                updatedRows: 1,
                businessName: 'Test Business',
                mock: true
            });

            expect(mockSheets.spreadsheets.values.append).not.toHaveBeenCalled();
        });

        it('should handle API errors', async () => {
            googleSheetsService.sheets = mockSheets;
            const apiError = new Error('Sheets API error');
            mockSheets.spreadsheets.values.append.mockRejectedValue(apiError);

            await expect(googleSheetsService.appendRow(mockBusinessData))
                .rejects.toThrow('Google Sheets save failed for Test Business: Sheets API error');
        });

        it('should authenticate if not already authenticated', async () => {
            googleSheetsService.sheets = null;
            fs.access.mockResolvedValue();
            fs.readFile.mockResolvedValue(JSON.stringify({
                type: 'service_account',
                project_id: 'test'
            }));
            mockSheets.spreadsheets.values.append.mockResolvedValue(mockAppendResponse);

            await googleSheetsService.appendRow(mockBusinessData);

            expect(mockedGoogle.sheets).toHaveBeenCalled();
            expect(mockSheets.spreadsheets.values.append).toHaveBeenCalled();
        });
    });

    describe('createHeaders', () => {
        const mockUpdateResponse = {
            data: {
                updatedRows: 1,
                updatedRange: 'Sheet1!A1:D1'
            }
        };

        it('should create headers successfully', async () => {
            googleSheetsService.sheets = mockSheets;
            mockSheets.spreadsheets.values.update.mockResolvedValue(mockUpdateResponse);

            const result = await googleSheetsService.createHeaders();

            expect(result).toBe(true);
            expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith({
                spreadsheetId: 'test-spreadsheet-id',
                range: 'Sheet1!A1:D1',
                valueInputOption: 'RAW',
                resource: {
                    values: [['Name', 'Address', 'Phone', 'Website']]
                }
            });
        });

        it('should handle header creation errors', async () => {
            googleSheetsService.sheets = mockSheets;
            mockSheets.spreadsheets.values.update.mockRejectedValue(new Error('Update failed'));

            await expect(googleSheetsService.createHeaders())
                .rejects.toThrow('Update failed');
        });
    });

    describe('checkCredentialsFile', () => {
        it('should return true if credentials file exists', async () => {
            fs.access.mockResolvedValue();

            const result = await googleSheetsService.checkCredentialsFile();

            expect(result).toBe(true);
            expect(fs.access).toHaveBeenCalledWith('./test-credentials.json');
        });

        it('should return false if credentials file does not exist', async () => {
            fs.access.mockRejectedValue(new Error('File not found'));

            const result = await googleSheetsService.checkCredentialsFile();

            expect(result).toBe(false);
        });
    });

    describe('createCredentialsTemplate', () => {
        it('should create credentials template file', async () => {
            fs.writeFile.mockResolvedValue();

            await googleSheetsService.createCredentialsTemplate();

            expect(fs.writeFile).toHaveBeenCalledWith(
                './test-credentials.json',
                expect.stringContaining('_comment')
            );
        });
    });
});