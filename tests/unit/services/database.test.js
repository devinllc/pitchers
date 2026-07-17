const DatabaseService = require('../../../services/database');
const { Pool } = require('pg');

// Mock pg
jest.mock('pg');
const MockedPool = Pool;

// Mock ErrorHandler
jest.mock('../../../services/errorHandler', () => {
    return jest.fn().mockImplementation(() => ({
        logProgress: jest.fn(),
        logDataSave: jest.fn(),
        logDataSaveFailure: jest.fn(),
        logAndContinue: jest.fn()
    }));
});

describe('DatabaseService', () => {
    let databaseService;
    let mockPool;
    let mockClient;
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
        process.env.DB_HOST = 'localhost';
        process.env.DB_PORT = '5432';
        process.env.DB_NAME = 'testdb';
        process.env.DB_USER = 'testuser';
        process.env.DB_PASSWORD = 'testpass';

        // Mock client
        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };

        // Mock pool
        mockPool = {
            connect: jest.fn().mockResolvedValue(mockClient),
            end: jest.fn(),
            on: jest.fn()
        };

        MockedPool.mockImplementation(() => mockPool);

        databaseService = new DatabaseService();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor', () => {
        it('should initialize pool with environment variables', () => {
            expect(MockedPool).toHaveBeenCalledWith({
                connectionString: 'postgresql://test:test@localhost:5432/testdb',
                host: 'localhost',
                port: '5432',
                database: 'testdb',
                user: 'testuser',
                password: 'testpass',
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000
            });
        });

        it('should set up error handler for pool errors', () => {
            expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
        });
    });

    describe('connect', () => {
        it('should connect successfully', async () => {
            const result = await databaseService.connect();

            expect(result).toBe(true);
            expect(mockPool.connect).toHaveBeenCalled();
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle connection errors', async () => {
            const connectionError = new Error('Connection failed');
            mockPool.connect.mockRejectedValue(connectionError);

            await expect(databaseService.connect()).rejects.toThrow('Connection failed');
        });
    });

    describe('createBusinessesTable', () => {
        it('should create table successfully', async () => {
            mockClient.query.mockResolvedValue({});

            const result = await databaseService.createBusinessesTable();

            expect(result).toBe(true);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE IF NOT EXISTS businesses')
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle table creation errors', async () => {
            const tableError = new Error('Table creation failed');
            mockClient.query.mockRejectedValue(tableError);

            await expect(databaseService.createBusinessesTable()).rejects.toThrow('Table creation failed');
        });
    });

    describe('insertBusiness', () => {
        const mockBusinessData = {
            name: 'Test Business',
            address: '123 Test Street',
            phone: '+91 98765 43210',
            website: 'https://testbusiness.com',
            rating: 4.5,
            totalReviews: 150,
            openingHours: ['Monday: 9:00 AM – 6:00 PM'],
            placeId: 'test_place_id',
            searchPhrase: 'Delhi restaurant'
        };

        it('should insert business successfully', async () => {
            const mockQueryResult = {
                rows: [{ id: 1, inserted: true }]
            };
            mockClient.query.mockResolvedValue(mockQueryResult);

            const result = await databaseService.insertBusiness(mockBusinessData);

            expect(result).toEqual({
                id: 1,
                inserted: true,
                businessName: 'Test Business',
                placeId: 'test_place_id'
            });

            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO businesses'),
                [
                    'Test Business',
                    '123 Test Street',
                    '+91 98765 43210',
                    'https://testbusiness.com',
                    4.5,
                    150,
                    JSON.stringify(['Monday: 9:00 AM – 6:00 PM']),
                    'test_place_id',
                    'Delhi restaurant'
                ]
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle missing business data fields', async () => {
            const incompleteData = { name: 'Test Business' };
            const mockQueryResult = {
                rows: [{ id: 1, inserted: true }]
            };
            mockClient.query.mockResolvedValue(mockQueryResult);

            await databaseService.insertBusiness(incompleteData);

            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO businesses'),
                [
                    'Test Business',
                    '',
                    '',
                    '',
                    null,
                    null,
                    null,
                    '',
                    ''
                ]
            );
        });

        it('should handle update on conflict', async () => {
            const mockQueryResult = {
                rows: [{ id: 1, inserted: false }] // xmax != 0 means update
            };
            mockClient.query.mockResolvedValue(mockQueryResult);

            const result = await databaseService.insertBusiness(mockBusinessData);

            expect(result.inserted).toBe(false);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('ON CONFLICT (place_id) DO UPDATE SET'),
                expect.any(Array)
            );
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Database error');
            mockClient.query.mockRejectedValue(dbError);

            await expect(databaseService.insertBusiness(mockBusinessData))
                .rejects.toThrow('Database save failed for Test Business: Database error');

            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should release client even on error', async () => {
            mockClient.query.mockRejectedValue(new Error('Query failed'));

            try {
                await databaseService.insertBusiness(mockBusinessData);
            } catch (error) {
                // Expected to throw
            }

            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('insertBusinessBatch', () => {
        const mockBusinessArray = [
            { name: 'Business 1', placeId: 'place1' },
            { name: 'Business 2', placeId: 'place2' }
        ];

        it('should insert batch successfully', async () => {
            mockClient.query
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockResolvedValueOnce({ rows: [{ id: 2 }] });

            const result = await databaseService.insertBusinessBatch(mockBusinessArray);

            expect(result).toEqual([{ id: 1 }, { id: 2 }]);
            expect(mockClient.query).toHaveBeenCalledTimes(2);
        });

        it('should handle empty array', async () => {
            const result = await databaseService.insertBusinessBatch([]);
            expect(result).toEqual([]);
            expect(mockClient.query).not.toHaveBeenCalled();
        });

        it('should continue on individual failures', async () => {
            mockClient.query
                .mockResolvedValueOnce({ rows: [{ id: 1 }] })
                .mockRejectedValueOnce(new Error('Insert failed'))
                .mockResolvedValueOnce({ rows: [{ id: 3 }] });

            const businessArray = [
                { name: 'Business 1' },
                { name: 'Business 2' },
                { name: 'Business 3' }
            ];

            const result = await databaseService.insertBusinessBatch(businessArray);

            expect(result).toEqual([{ id: 1 }, null, { id: 3 }]);
        });

        it('should handle null or undefined input', async () => {
            expect(await databaseService.insertBusinessBatch(null)).toEqual([]);
            expect(await databaseService.insertBusinessBatch(undefined)).toEqual([]);
        });
    });

    describe('testConnection', () => {
        it('should test connection successfully', async () => {
            const mockQueryResult = {
                rows: [{ now: '2024-01-01T00:00:00.000Z' }]
            };
            mockClient.query.mockResolvedValue(mockQueryResult);

            const result = await databaseService.testConnection();

            expect(result).toBe(true);
            expect(mockClient.query).toHaveBeenCalledWith('SELECT NOW()');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle connection test failure', async () => {
            mockPool.connect.mockRejectedValue(new Error('Connection failed'));

            const result = await databaseService.testConnection();

            expect(result).toBe(false);
        });

        it('should release client even on error', async () => {
            mockClient.query.mockRejectedValue(new Error('Query failed'));

            const result = await databaseService.testConnection();

            expect(result).toBe(false);
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('getBusinessCount', () => {
        it('should get business count successfully', async () => {
            const mockQueryResult = {
                rows: [{ count: '42' }]
            };
            mockClient.query.mockResolvedValue(mockQueryResult);

            const result = await databaseService.getBusinessCount();

            expect(result).toBe(42);
            expect(mockClient.query).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM businesses');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle count query errors', async () => {
            mockClient.query.mockRejectedValue(new Error('Count failed'));

            await expect(databaseService.getBusinessCount()).rejects.toThrow('Count failed');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('getBusinessesBySearchPhrase', () => {
        it('should get businesses by search phrase successfully', async () => {
            const mockBusinesses = [
                { id: 1, name: 'Business 1', search_phrase: 'Delhi restaurant' },
                { id: 2, name: 'Business 2', search_phrase: 'Delhi restaurant' }
            ];
            mockClient.query.mockResolvedValue({ rows: mockBusinesses });

            const result = await databaseService.getBusinessesBySearchPhrase('Delhi restaurant');

            expect(result).toEqual(mockBusinesses);
            expect(mockClient.query).toHaveBeenCalledWith(
                'SELECT * FROM businesses WHERE search_phrase = $1 ORDER BY created_at DESC',
                ['Delhi restaurant']
            );
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should handle search phrase query errors', async () => {
            mockClient.query.mockRejectedValue(new Error('Search failed'));

            await expect(databaseService.getBusinessesBySearchPhrase('test'))
                .rejects.toThrow('Search failed');
            expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('close', () => {
        it('should close pool successfully', async () => {
            await databaseService.close();

            expect(mockPool.end).toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should handle pool errors through error handler', () => {
            const poolErrorHandler = mockPool.on.mock.calls.find(call => call[0] === 'error')[1];
            const testError = new Error('Pool error');

            poolErrorHandler(testError);

            expect(databaseService.errorHandler.logAndContinue).toHaveBeenCalledWith(
                testError,
                {
                    operation: 'database_pool_error',
                    context: 'Unexpected error on idle client'
                }
            );
        });
    });
});